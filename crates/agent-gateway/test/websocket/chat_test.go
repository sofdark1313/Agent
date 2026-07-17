package websocket_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/liveagent/agent-gateway/internal/config"
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/server"
	"github.com/liveagent/agent-gateway/internal/session"
)

func newChatWebSocketTest(t *testing.T) (*session.Manager, *session.AgentSession, *websocket.Conn, func()) {
	t.Helper()

	sm := session.NewManager()
	sm.RecordAuthentication("desktop-agent", "0.9.0", "session-1")
	agentSession := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(agentSession)

	handler := server.NewWebSocketServer(&config.Config{
		Token:          "ws-token",
		RequestTimeout: time.Second,
	}, sm)
	conn, cleanup := dialGatewayWebSocket(t, handler)
	authWebSocket(t, conn, "ws-token")
	return sm, agentSession, conn, cleanup
}

func decodePayload(t *testing.T, env wsEnvelope) map[string]any {
	t.Helper()
	payload := map[string]any{}
	if len(env.Payload) > 0 {
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			t.Fatalf("decode payload for %s: %v", env.Type, err)
		}
	}
	return payload
}

// receiveEventOfType skips unrelated frames (pings, other event types) until
// an envelope of the wanted type arrives.
func receiveEventOfType(t *testing.T, conn *websocket.Conn, eventType string) map[string]any {
	t.Helper()
	for attempt := 0; attempt < 16; attempt++ {
		env := receiveEnvelope(t, conn)
		if env.Type == eventType {
			return decodePayload(t, env)
		}
	}
	t.Fatalf("timed out waiting for %s event", eventType)
	return nil
}

func dispatchStarted(sm *session.Manager, runID string, conversationID string) {
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: runID,
		Payload: &gatewayv1.AgentEnvelope_ChatControl{
			ChatControl: &gatewayv1.ChatControlEvent{
				RequestId:      runID,
				ConversationId: conversationID,
				Type:           "started",
				State:          "running",
			},
		},
	})
}

func dispatchToken(sm *session.Manager, runID string, conversationID string, text string) {
	data, _ := json.Marshal(map[string]any{"text": text})
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: runID,
		Payload: &gatewayv1.AgentEnvelope_ChatEvent{
			ChatEvent: &gatewayv1.ChatEvent{
				Type:           gatewayv1.ChatEvent_TOKEN,
				ConversationId: conversationID,
				Data:           string(data),
			},
		},
	})
}

func dispatchDone(sm *session.Manager, runID string, conversationID string) {
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: runID,
		Payload: &gatewayv1.AgentEnvelope_ChatEvent{
			ChatEvent: &gatewayv1.ChatEvent{
				Type:           gatewayv1.ChatEvent_DONE,
				ConversationId: conversationID,
				Data:           "{}",
			},
		},
	})
}

// The subscription is conversation-scoped and persists across run boundaries:
// a queued prompt auto-send (new run started by the desktop app) streams into
// the same subscription with no re-subscribe handshake.
func TestChatSubscribePersistsAcrossRunHandoff(t *testing.T) {
	t.Parallel()

	sm, _, conn, cleanup := newChatWebSocketTest(t)
	defer cleanup()

	sendEnvelope(t, conn, "sub-1", "chat.subscribe", map[string]any{
		"conversation_id": "conversation-1",
	})
	resp := decodePayload(t, receiveEnvelopeWithID(t, conn, "sub-1"))
	if resp["conversation_id"] != "conversation-1" || resp["stream_epoch"] == "" {
		t.Fatalf("subscribe response = %#v", resp)
	}
	if resp["activity"] != nil {
		t.Fatalf("idle conversation must report nil activity, got %#v", resp["activity"])
	}

	dispatchStarted(sm, "run-1", "conversation-1")
	started := receiveEventOfType(t, conn, "chat.event")
	if started["type"] != "run_started" || started["run_id"] != "run-1" {
		t.Fatalf("first push = %#v, want run_started run-1", started)
	}

	dispatchToken(sm, "run-1", "conversation-1", "hello")
	token := receiveEventOfType(t, conn, "chat.event")
	if token["type"] != "token" || token["run_id"] != "run-1" || token["text"] != "hello" {
		t.Fatalf("token push = %#v", token)
	}

	dispatchDone(sm, "run-1", "conversation-1")
	finished := receiveEventOfType(t, conn, "chat.event")
	if finished["type"] != "run_finished" || finished["status"] != "completed" {
		t.Fatalf("finish push = %#v", finished)
	}

	// Queue auto-send: a new run flows into the same subscription.
	dispatchStarted(sm, "run-2", "conversation-1")
	second := receiveEventOfType(t, conn, "chat.event")
	if second["type"] != "run_started" || second["run_id"] != "run-2" {
		t.Fatalf("handoff push = %#v, want run_started run-2", second)
	}
	dispatchToken(sm, "run-2", "conversation-1", "again")
	tail := receiveEventOfType(t, conn, "chat.event")
	if tail["run_id"] != "run-2" || tail["text"] != "again" {
		t.Fatalf("handoff token = %#v", tail)
	}
}

func TestChatActivityBroadcastCarriesRunIDs(t *testing.T) {
	t.Parallel()

	sm, _, conn, cleanup := newChatWebSocketTest(t)
	defer cleanup()

	dispatchStarted(sm, "run-1", "conversation-1")
	running := receiveEventOfType(t, conn, "chat.activity")
	if running["running"] != true || running["run_id"] != "run-1" || running["conversation_id"] != "conversation-1" {
		t.Fatalf("running activity = %#v", running)
	}

	dispatchDone(sm, "run-1", "conversation-1")
	idle := receiveEventOfType(t, conn, "chat.activity")
	if idle["running"] != false || idle["conversation_id"] != "conversation-1" {
		t.Fatalf("idle activity = %#v", idle)
	}
}

func TestChatCommandSubmitSeedsUserMessageAndDeliversEnvelope(t *testing.T) {
	t.Parallel()

	sm, agentSession, conn, cleanup := newChatWebSocketTest(t)
	defer cleanup()

	sendEnvelope(t, conn, "sub-1", "chat.subscribe", map[string]any{
		"conversation_id": "conversation-1",
	})
	receiveEnvelopeWithID(t, conn, "sub-1")

	sendEnvelope(t, conn, "cmd-1", "chat.command", map[string]any{
		"type": "chat.submit",
		"payload": map[string]any{
			"message":           "hello agent",
			"conversation_id":   "conversation-1",
			"client_request_id": "client-1",
		},
	})
	answerChatRuntimeProbe(t, sm, agentSession)

	resp := decodePayload(t, receiveEnvelopeWithID(t, conn, "cmd-1"))
	runID, _ := resp["run_id"].(string)
	if runID == "" || resp["conversation_id"] != "conversation-1" {
		t.Fatalf("command response = %#v", resp)
	}
	if seq, ok := resp["accepted_seq"].(float64); !ok || seq <= 0 {
		t.Fatalf("accepted_seq = %#v, want > 0", resp["accepted_seq"])
	}
	if resp["deduped"] != false {
		t.Fatalf("first command deduped = %#v, want false", resp["deduped"])
	}

	seeded := receiveEventOfType(t, conn, "chat.event")
	if seeded["type"] != "user_message" ||
		seeded["message"] != "hello agent" ||
		seeded["client_request_id"] != "client-1" ||
		seeded["run_id"] != runID {
		t.Fatalf("seeded user_message = %#v", seeded)
	}

	outbound := readOutboundEnvelope(t, agentSession)
	command := outbound.GetChatCommand()
	if command == nil || command.GetType() != "chat.submit" {
		t.Fatalf("outbound payload = %#v, want chat.submit command", outbound.GetPayload())
	}
	if command.GetRequest().GetMessage() != "hello agent" ||
		command.GetRequest().GetClientRequestId() != "client-1" {
		t.Fatalf("chat command request = %#v", command.GetRequest())
	}

	// A retry with the same client_request_id returns the canonical run through
	// the priority response path. It must neither probe nor dispatch nor seed a
	// second user message.
	sendEnvelope(t, conn, "cmd-2", "chat.command", map[string]any{
		"type": "chat.submit",
		"payload": map[string]any{
			"message":           "hello agent",
			"conversation_id":   "conversation-1",
			"client_request_id": "client-1",
		},
	})
	retry := decodePayload(t, receiveEnvelopeWithID(t, conn, "cmd-2"))
	if retry["run_id"] != runID || retry["deduped"] != true {
		t.Fatalf("deduplicated command response = %#v, want run %q", retry, runID)
	}
	select {
	case duplicate := <-agentSession.Outbound():
		duplicate.Ack(nil)
		t.Fatalf("deduplicated command dispatched another envelope: %#v", duplicate.GatewayEnvelope)
	case <-time.After(50 * time.Millisecond):
	}
	replay := sm.SubscribeConversationStream("conversation-1", 0, "")
	userMessages := 0
	for _, event := range replay.Events {
		if event.Type == "user_message" {
			userMessages++
		}
	}
	replay.Cleanup()
	if userMessages != 1 {
		t.Fatalf("deduplicated command seeded %d user messages, want 1", userMessages)
	}

	// The agent's user_message echo is swallowed: the next stream event after
	// run start must not duplicate the seeded message.
	dispatchStarted(sm, runID, "conversation-1")
	startedPush := receiveEventOfType(t, conn, "chat.event")
	if startedPush["type"] != "run_started" {
		t.Fatalf("post-start push = %#v", startedPush)
	}
	echoData, _ := json.Marshal(map[string]any{"message": "hello agent"})
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: runID,
		Payload: &gatewayv1.AgentEnvelope_ChatEvent{
			ChatEvent: &gatewayv1.ChatEvent{
				Type:           gatewayv1.ChatEvent_USER_MESSAGE,
				ConversationId: "conversation-1",
				Data:           string(echoData),
			},
		},
	})
	dispatchToken(sm, runID, "conversation-1", "reply")
	next := receiveEventOfType(t, conn, "chat.event")
	if next["type"] != "token" || next["text"] != "reply" {
		t.Fatalf("expected token after swallowed echo, got %#v", next)
	}
}

func TestChatPrepareProbesAgentAndReturnsStatus(t *testing.T) {
	t.Parallel()

	sm, agentSession, conn, cleanup := newChatWebSocketTest(t)
	defer cleanup()

	sendEnvelope(t, conn, "prepare-1", "chat.prepare", map[string]any{
		"reason": "foreground",
	})
	answerChatRuntimeProbe(t, sm, agentSession)

	status := decodePayload(t, receiveEnvelopeWithID(t, conn, "prepare-1"))
	if status["online"] != true || status["agent_ready"] != true {
		t.Fatalf("chat.prepare status = %#v", status)
	}
	if status["chat_runtime_ready"] != false {
		t.Fatalf("chat.prepare runtime readiness = %#v, want false without heartbeat", status)
	}

	// The immediately following command reuses the session-bound successful
	// prepare result. Its next native envelope must be the command itself, not a
	// second Ping that adds another round trip to the normal send path.
	sendEnvelope(t, conn, "cmd-after-prepare", "chat.command", map[string]any{
		"type": "chat.submit",
		"payload": map[string]any{
			"message":           "hello after prepare",
			"conversation_id":   "conversation-prepare",
			"client_request_id": "client-prepare",
		},
	})
	accepted := decodePayload(t, receiveEnvelopeWithID(t, conn, "cmd-after-prepare"))
	if runID, ok := accepted["run_id"].(string); !ok || runID == "" {
		t.Fatalf("command after prepare response = %#v", accepted)
	}
	command := readOutboundEnvelope(t, agentSession)
	if command.GetChatCommand() == nil || command.GetPing() != nil {
		t.Fatalf("command after fresh prepare = %#v, want ChatCommand without another Ping", command)
	}
}

func TestChatCancelKeepsRunAliveUntilAgentConfirms(t *testing.T) {
	t.Parallel()

	sm, agentSession, conn, cleanup := newChatWebSocketTest(t)
	defer cleanup()

	sendEnvelope(t, conn, "sub-1", "chat.subscribe", map[string]any{
		"conversation_id": "conversation-1",
	})
	receiveEnvelopeWithID(t, conn, "sub-1")

	dispatchStarted(sm, "run-1", "conversation-1")
	receiveEventOfType(t, conn, "chat.event")

	sendEnvelope(t, conn, "cancel-1", "chat.command", map[string]any{
		"type":    "chat.cancel",
		"payload": map[string]any{"conversation_id": "conversation-1"},
	})

	// The gateway blocks the response on agent delivery; ack it first.
	outbound := readOutboundEnvelope(t, agentSession)
	if outbound.GetChatCommand().GetType() != "chat.cancel" {
		t.Fatalf("outbound cancel = %#v", outbound.GetPayload())
	}

	// The run is NOT terminalized by the gateway: activity flips to
	// cancelling and the agent's terminal signal wins. The response and the
	// activity push race on the outbox, so collect both order-independently.
	var cancelling map[string]any
	var resp map[string]any
	for attempt := 0; attempt < 16 && (cancelling == nil || resp == nil); attempt++ {
		env := receiveEnvelope(t, conn)
		switch {
		case env.Type == "chat.activity":
			payload := decodePayload(t, env)
			if payload["state"] == "cancelling" {
				cancelling = payload
			}
		case env.ID == "cancel-1":
			resp = decodePayload(t, env)
		}
	}
	if cancelling == nil || cancelling["running"] != true {
		t.Fatalf("cancelling activity = %#v", cancelling)
	}
	if resp == nil || resp["ok"] != true || resp["run_id"] != "run-1" {
		t.Fatalf("cancel response = %#v", resp)
	}

	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "run-1",
		Payload: &gatewayv1.AgentEnvelope_ChatControl{
			ChatControl: &gatewayv1.ChatControlEvent{
				RequestId:      "run-1",
				ConversationId: "conversation-1",
				Type:           "cancelled",
				State:          "cancelled",
			},
		},
	})
	finished := receiveEventOfType(t, conn, "chat.event")
	if finished["type"] != "run_finished" || finished["status"] != "cancelled" {
		t.Fatalf("cancel finish = %#v", finished)
	}
}

func TestChatSubscribeResumesWithAfterSeq(t *testing.T) {
	t.Parallel()

	sm, _, conn, cleanup := newChatWebSocketTest(t)
	defer cleanup()

	dispatchStarted(sm, "run-1", "conversation-1")
	dispatchToken(sm, "run-1", "conversation-1", "one")
	dispatchToken(sm, "run-1", "conversation-1", "two")

	sendEnvelope(t, conn, "sub-1", "chat.subscribe", map[string]any{
		"conversation_id": "conversation-1",
	})
	first := decodePayload(t, receiveEnvelopeWithID(t, conn, "sub-1"))
	events, _ := first["events"].([]any)
	if len(events) != 3 {
		t.Fatalf("full replay = %d events, want 3", len(events))
	}
	epoch, _ := first["stream_epoch"].(string)
	latest, _ := first["latest_seq"].(float64)

	sendEnvelope(t, conn, "sub-2", "chat.subscribe", map[string]any{
		"conversation_id": "conversation-1",
		"after_seq":       latest - 1,
		"stream_epoch":    epoch,
	})
	resumed := decodePayload(t, receiveEnvelopeWithID(t, conn, "sub-2"))
	resumedEvents, _ := resumed["events"].([]any)
	if resumed["reset"] != false || len(resumedEvents) != 1 {
		t.Fatalf("resume = reset:%v events:%d, want reset:false events:1", resumed["reset"], len(resumedEvents))
	}

	sendEnvelope(t, conn, "sub-3", "chat.subscribe", map[string]any{
		"conversation_id": "conversation-1",
		"after_seq":       latest,
		"stream_epoch":    "stale-epoch",
	})
	mismatched := decodePayload(t, receiveEnvelopeWithID(t, conn, "sub-3"))
	if mismatched["reset"] != true {
		t.Fatalf("epoch mismatch must reset, got %#v", mismatched)
	}
}
