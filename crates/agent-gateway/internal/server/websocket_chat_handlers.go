package server

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/liveagent/agent-gateway/internal/config"
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/session"
)

// chatStreamSubscription is one persistent per-conversation subscription on a
// websocket connection. It survives run boundaries and ends only on
// chat.unsubscribe, a replacing chat.subscribe, or connection close.
type chatStreamSubscription struct {
	conversationID string
	cancel         func()
}

func (c *websocketConnection) handleChatSubscribe(req websocketRequest) {
	var payload struct {
		ConversationID string `json:"conversation_id"`
		AfterSeq       int64  `json:"after_seq"`
		StreamEpoch    string `json:"stream_epoch"`
	}
	if err := decodeWebSocketPayload(req.Payload, &payload); err != nil {
		_ = c.writeError(req.ID, "invalid chat.subscribe payload")
		return
	}
	conversationID := strings.TrimSpace(payload.ConversationID)
	if conversationID == "" {
		_ = c.writeError(req.ID, "conversation_id is required")
		return
	}

	sub := c.sm.SubscribeConversationStream(conversationID, payload.AfterSeq, payload.StreamEpoch)

	events := make([]map[string]any, 0, len(sub.Events))
	for _, event := range sub.Events {
		events = append(events, event.Payload)
	}
	resp := map[string]any{
		"conversation_id": sub.ConversationID,
		"stream_epoch":    sub.StreamEpoch,
		"latest_seq":      sub.LatestSeq,
		"reset":           sub.Reset,
		"activity":        websocketRunActivityPayload(sub.Activity),
		"snapshot":        websocketRunSnapshotPayload(sub.Snapshot),
		"events":          events,
	}

	// Register (replacing any previous subscription for this conversation)
	// before responding so no live event published after the replay boundary
	// is dropped.
	entry := &chatStreamSubscription{
		conversationID: conversationID,
		cancel:         sub.Cleanup,
	}
	c.chatStreamsMu.Lock()
	if c.chatStreams == nil {
		c.chatStreams = make(map[string]*chatStreamSubscription)
	}
	if previous := c.chatStreams[conversationID]; previous != nil {
		previous.cancel()
	}
	c.chatStreams[conversationID] = entry
	c.chatStreamsMu.Unlock()

	if err := c.writeResponse(req.ID, resp); err != nil {
		sub.Cleanup()
		c.chatStreamsMu.Lock()
		if c.chatStreams[conversationID] == entry {
			delete(c.chatStreams, conversationID)
		}
		c.chatStreamsMu.Unlock()
		// A shed subscribe response would otherwise dead-end the stream: the
		// client's request just times out and nothing ever resubscribes. The
		// control-queue reset re-arms its recovery loop.
		if errors.Is(err, errWriteQueueFull) {
			c.writeSubscriptionResetOrClose(conversationID)
		}
		return
	}

	go c.forwardConversationEvents(conversationID, sub)
}

// forwardConversationEvents pushes live stream events to the client. When the
// subscriber channel closes because it overflowed — or the connection's own
// write queue stays full — the client is told to re-subscribe (resume by
// after_seq replays the missed tail from the buffer). Congestion sheds this
// subscription, never the connection.
func (c *websocketConnection) forwardConversationEvents(
	conversationID string,
	sub *session.ConversationSubscription,
) {
	defer sub.Cleanup()
	for {
		select {
		case <-c.done:
			return
		case event, ok := <-sub.EventCh:
			if !ok {
				if sub.Overflowed() {
					c.writeSubscriptionResetOrClose(conversationID)
				}
				return
			}
			if err := c.writeEvent("chat.event", event.Payload); err != nil {
				if errors.Is(err, errWriteQueueFull) {
					// The reset rides the control queue, so it overtakes the
					// congested data backlog; stale queued chat.events are
					// deduped client-side by seq after the resync.
					c.writeSubscriptionResetOrClose(conversationID)
				}
				return
			}
		}
	}
}

// writeSubscriptionResetOrClose delivers the one signal that lets a client
// recover a shed conversation stream. If even the control queue cannot take
// it, the link is beyond load-shedding: closing forces a reconnect whose
// resubscribe (after_seq) is the only remaining path that cannot be lost.
func (c *websocketConnection) writeSubscriptionResetOrClose(conversationID string) {
	if err := c.writeEvent("chat.subscription_reset", map[string]any{
		"conversation_id": conversationID,
	}); err != nil {
		c.close()
	}
}

// handleChatActivities answers from gateway state only — no agent round-trip
// — so clients can reconcile running conversations while the desktop is
// offline.
func (c *websocketConnection) handleChatActivities(req websocketRequest) {
	var body struct{}
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid chat.activities payload")
		return
	}
	_ = c.writeResponse(req.ID, map[string]any{
		"running_conversations": websocketRunningConversationsPayload(c.sm.ActiveConversationActivities()),
	})
}

func (c *websocketConnection) handleChatUnsubscribe(req websocketRequest) {
	var payload struct {
		ConversationID string `json:"conversation_id"`
	}
	if err := decodeWebSocketPayload(req.Payload, &payload); err != nil {
		_ = c.writeError(req.ID, "invalid chat.unsubscribe payload")
		return
	}
	conversationID := strings.TrimSpace(payload.ConversationID)

	c.chatStreamsMu.Lock()
	if sub := c.chatStreams[conversationID]; sub != nil {
		sub.cancel()
		delete(c.chatStreams, conversationID)
	}
	c.chatStreamsMu.Unlock()

	_ = c.writeResponse(req.ID, map[string]any{"ok": true})
}

func (c *websocketConnection) cleanupChatStreamSubscriptions() {
	c.chatStreamsMu.Lock()
	for conversationID, sub := range c.chatStreams {
		sub.cancel()
		delete(c.chatStreams, conversationID)
	}
	c.chatStreamsMu.Unlock()
}

func (c *websocketConnection) handleChatPrepare(req websocketRequest) {
	var payload struct {
		Reason string `json:"reason"`
	}
	if err := decodeWebSocketPayload(req.Payload, &payload); err != nil {
		_ = c.writeError(req.ID, "invalid chat.prepare payload")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), chatPrepareTimeout(c.cfg))
	defer cancel()
	if err := probeChatRuntime(ctx, c.sm); err != nil {
		_ = c.writeError(req.ID, websocketErrorMessage(err))
		return
	}

	// Keep the response shape identical to status.get so older and newer WebUI
	// clients can share one status normalizer.
	_ = c.writePriorityResponse(req.ID, c.sm.Status())
}

func (c *websocketConnection) handleChatCommand(req websocketRequest) {
	commandType, body, baseMessageRef, err := decodeChatCommandPayload(req.Payload)
	if err != nil {
		_ = c.writeError(req.ID, "invalid chat command payload")
		return
	}

	switch commandType {
	case "chat.submit":
		baseMessageRef = nil
	case "chat.edit_resend":
		if baseMessageRef == nil {
			_ = c.writeError(req.ID, "base_message_ref is required")
			return
		}
		if err := validateChatMessageRef(baseMessageRef); err != nil {
			_ = c.writeError(req.ID, err.Error())
			return
		}
	case "chat.cancel":
		c.handleChatCancel(req)
		return
	default:
		_ = c.writeError(req.ID, "unsupported chat command")
		return
	}

	if err := normalizeChatRequestBody(&body); err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}

	if existing, ok := c.sm.LookupChatCommand(body.ClientRequestID); ok {
		c.respondChatCommandDeduped(req.ID, existing)
		return
	}

	if !c.sm.IsOnline() {
		_ = c.writeError(req.ID, "agent offline")
		return
	}
	probeCtx, probeCancel := context.WithTimeout(
		context.Background(), chatPrepareTimeout(c.cfg),
	)
	probeErr := probeChatRuntimeForCommand(probeCtx, c.sm)
	probeCancel()
	if probeErr != nil {
		_ = c.writeError(req.ID, websocketErrorMessage(probeErr))
		return
	}

	runID := "chat-command-" + uuid.NewString()
	start := c.sm.StartChatCommand(
		runID,
		body.ConversationID,
		body.Workdir,
		body.ClientRequestID,
		buildAcceptedChatCommandPayloads(body, baseMessageRef),
	)
	if start.Deduped {
		c.respondChatCommandDeduped(req.ID, start)
		return
	}
	updates, cleanupWatch := c.sm.WatchChatCommand(start.RunID)

	_ = c.writeChatCommandAcceptedResponse(req.ID, start)

	go c.forwardChatCommandUpdates(updates, cleanupWatch)
	go dispatchAcceptedChatCommand(
		context.Background(), c.cfg, c.sm, cleanupWatch, start, body, baseMessageRef, newChatTraceID(),
	)
}

// respondChatCommandDeduped answers a duplicated client_request_id with the
// canonical run and forwards its replayed/subsequent pre-stream updates. No
// dispatch happens here — the canonical submission owns delivery and its
// startup watchdog; this watch is bounded by cleanupChatCommandWatchAfter.
func (c *websocketConnection) respondChatCommandDeduped(
	requestID string,
	start session.ChatCommandStart,
) {
	updates, cleanupWatch := c.sm.WatchChatCommand(start.RunID)
	_ = c.writeChatCommandAcceptedResponse(requestID, start)
	go c.forwardChatCommandUpdates(updates, cleanupWatch)
	cleanupChatCommandWatchAfter(c.cfg, cleanupWatch)
}

func (c *websocketConnection) writeChatCommandAcceptedResponse(
	requestID string,
	start session.ChatCommandStart,
) error {
	return c.writePriorityResponse(requestID, map[string]any{
		"run_id":          start.RunID,
		"conversation_id": start.ConversationID,
		"accepted_seq":    start.AcceptedSeq,
		"deduped":         start.Deduped,
	})
}

// forwardChatCommandUpdates relays pre-stream command outcomes (bound /
// queued_in_gui / failed) to the connection that issued the command. The
// watch is closed by the command's startup watchdog.
func (c *websocketConnection) forwardChatCommandUpdates(
	updates <-chan session.ChatCommandUpdate,
	cleanup func(),
) {
	if cleanup != nil {
		defer cleanup()
	}
	for {
		select {
		case <-c.done:
			return
		case update, ok := <-updates:
			if !ok {
				return
			}
			payload := map[string]any{
				"run_id":            update.RunID,
				"client_request_id": update.ClientRequestID,
				"phase":             update.Phase,
			}
			if update.ConversationID != "" {
				payload["conversation_id"] = update.ConversationID
			}
			if update.ErrorCode != "" {
				payload["error_code"] = update.ErrorCode
			}
			if update.Message != "" {
				payload["message"] = update.Message
			}
			if err := c.writeEvent("chat.command_update", payload); err != nil {
				return
			}
		}
	}
}

// cleanupChatCommandWatchAfter bounds a deduplicated submit's update watch.
// time.AfterFunc keeps no goroutine parked while it waits; cleanup is
// idempotent, so racing the forwarder's own deferred cleanup is harmless.
func cleanupChatCommandWatchAfter(cfg *config.Config, cleanup func()) {
	if cleanup == nil {
		return
	}
	timeout := chatStartTimeout(cfg) + chatRenderStartTimeout(cfg)
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	time.AfterFunc(timeout, cleanup)
}

func (c *websocketConnection) handleChatCancel(req websocketRequest) {
	raw := req.Payload
	// chat.cancel arrives either directly or wrapped in a chat.command
	// envelope ({type, payload}); unwrap the latter.
	var wrapper struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(raw, &wrapper); err == nil &&
		strings.TrimSpace(wrapper.Type) == "chat.cancel" && len(wrapper.Payload) > 0 {
		raw = wrapper.Payload
	}

	var payload struct {
		ConversationID string `json:"conversation_id"`
		RunID          string `json:"run_id"`
	}
	if err := decodeWebSocketPayload(raw, &payload); err != nil {
		_ = c.writeError(req.ID, "invalid chat.cancel payload")
		return
	}
	payload.ConversationID = strings.TrimSpace(payload.ConversationID)
	payload.RunID = strings.TrimSpace(payload.RunID)
	if payload.ConversationID == "" {
		_ = c.writeError(req.ID, "conversation_id is required")
		return
	}
	if !c.sm.IsOnline() {
		_ = c.writeError(req.ID, "agent offline")
		return
	}

	// The run is not terminalized here: the activity flips to "cancelling",
	// the agent's real terminal signal wins, and a watchdog force-finishes if
	// the agent never reports back.
	runID, active := c.sm.MarkConversationCancelling(payload.ConversationID, payload.RunID)
	if !active {
		_ = c.writeResponse(req.ID, map[string]any{
			"ok": true, "run_id": "", "conversation_id": payload.ConversationID,
		})
		return
	}

	timeout := 10 * time.Second
	if c.cfg != nil && c.cfg.WebSocketWriteTimeout > 0 {
		timeout = c.cfg.WebSocketWriteTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if err := c.sm.SendToAgentContext(ctx, &gatewayv1.GatewayEnvelope{
		RequestId: runID,
		Timestamp: time.Now().Unix(),
		Payload:   buildChatCancelCommandPayload(payload.ConversationID),
	}); err != nil {
		_ = c.writeError(req.ID, websocketErrorMessage(err))
		return
	}

	go watchChatCancel(c.sm, runID)
	_ = c.writeResponse(req.ID, map[string]any{
		"ok": true, "run_id": runID, "conversation_id": payload.ConversationID,
	})
}

const chatCancelWatchdogTimeout = 15 * time.Second

func watchChatCancel(sm *session.Manager, runID string) {
	time.Sleep(chatCancelWatchdogTimeout)
	sm.ForceFinishRun(runID, "cancelled", "cancel_timeout",
		"The desktop runtime did not confirm the cancellation in time.")
}
