package session_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/session"
)

func newTestSessionManager() *session.Manager {
	sm := session.NewManager()
	sm.RecordAuthentication("desktop-agent", "0.9.0", "session-1")
	return sm
}

func dispatchChatControl(
	sm *session.Manager,
	requestID string,
	conversationID string,
	controlType string,
	state string,
) {
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: requestID,
		Payload: &gatewayv1.AgentEnvelope_ChatControl{
			ChatControl: &gatewayv1.ChatControlEvent{
				RequestId:      requestID,
				ConversationId: conversationID,
				Type:           controlType,
				State:          state,
			},
		},
	})
}

func assertDoneClosed(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for session done to close")
	}
}

func assertDoneOpen(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
		t.Fatalf("session done is closed")
	default:
	}
}

func TestClearSessionDoesNotCloseReplacement(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	first := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(first)
	second := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(second)

	assertDoneClosed(t, first.Done())
	assertDoneOpen(t, second.Done())

	sm.ClearSession(first)
	if status := sm.Status(); !status.Online {
		t.Fatalf("status online = false after clearing stale session")
	}
	assertDoneOpen(t, second.Done())

	env := &gatewayv1.GatewayEnvelope{RequestId: "still-current"}
	if err := sm.SendToAgent(env); err != nil {
		t.Fatalf("SendToAgent after stale ClearSession: %v", err)
	}
	select {
	case got := <-second.Outbound():
		if got.GetRequestId() != "still-current" {
			t.Fatalf("request id = %q, want still-current", got.GetRequestId())
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for current session outbound message")
	}

	sm.ClearSession(second)
	assertDoneClosed(t, second.Done())
	if status := sm.Status(); status.Online {
		t.Fatalf("status online = true after clearing current session")
	}
	if err := sm.SendToAgent(env); !errors.Is(err, session.ErrAgentOffline) {
		t.Fatalf("SendToAgent after clearing current session = %v, want ErrAgentOffline", err)
	}
}

func TestClearSessionIfHeartbeatStaleClosesOnlyCurrentSession(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	first := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(first)
	second := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(second)

	time.Sleep(time.Millisecond)
	if sm.ClearSessionIfHeartbeatStale(first, time.Nanosecond) {
		t.Fatalf("stale first session should not close replacement session")
	}
	assertDoneOpen(t, second.Done())
	if status := sm.Status(); !status.Online {
		t.Fatalf("status online = false after stale old-session heartbeat timeout")
	}

	time.Sleep(time.Millisecond)
	if !sm.ClearSessionIfHeartbeatStale(second, time.Nanosecond) {
		t.Fatalf("current stale session was not cleared")
	}
	assertDoneClosed(t, second.Done())
	if status := sm.Status(); status.Online {
		t.Fatalf("status online = true after current session heartbeat timeout")
	}
	if err := sm.SendToAgent(&gatewayv1.GatewayEnvelope{RequestId: "after-timeout"}); !errors.Is(err, session.ErrAgentOffline) {
		t.Fatalf("SendToAgent after heartbeat timeout = %v, want ErrAgentOffline", err)
	}
}

func TestChatRuntimeReadyRequiresFreshRuntimeHeartbeat(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sess := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(sess)

	if status := sm.Status(); !status.Online || status.ChatRuntimeReady {
		t.Fatalf("initial status = %#v, want online without chat runtime readiness", status)
	}

	sm.UpdateRuntimeStatus(sess, &gatewayv1.RuntimeStatusEvent{
		WorkerId:       "runtime-1",
		State:          "ready",
		Visible:        true,
		ActiveRunCount: 0,
		Timestamp:      time.Now().Unix(),
	})
	if status := sm.Status(); !status.ChatRuntimeReady ||
		status.RuntimeState != "ready" ||
		status.RuntimeWorkerID != "runtime-1" ||
		status.RuntimeLastHeartbeat == 0 {
		t.Fatalf("ready runtime status = %#v", status)
	}

	sm.UpdateRuntimeStatus(sess, &gatewayv1.RuntimeStatusEvent{
		WorkerId:  "runtime-1",
		State:     "suspended",
		Timestamp: time.Now().Unix(),
	})
	if status := sm.Status(); status.ChatRuntimeReady || status.RuntimeState != "suspended" {
		t.Fatalf("suspended runtime status = %#v, want not ready", status)
	}

	sm.UpdateRuntimeStatus(sess, &gatewayv1.RuntimeStatusEvent{
		WorkerId:  "runtime-1",
		State:     "busy",
		Timestamp: time.Now().Unix(),
	})
	if !sm.ChatRuntimeReady() {
		t.Fatalf("busy runtime should be ready to manage chat runs")
	}

	sm.ClearSession(sess)
	if status := sm.Status(); status.ChatRuntimeReady || status.RuntimeState != "" {
		t.Fatalf("cleared session status = %#v, want runtime readiness reset", status)
	}
}

func TestRuntimeStatusUpdateBroadcastsStatus(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sess := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(sess)
	updates, cleanup := sm.SubscribeStatus()
	defer cleanup()

	sm.UpdateRuntimeStatus(sess, &gatewayv1.RuntimeStatusEvent{
		WorkerId:       "runtime-broadcast",
		State:          "ready",
		Visible:        true,
		ActiveRunCount: 2,
		Timestamp:      time.Now().Unix(),
	})

	select {
	case status := <-updates:
		if !status.Online || !status.ChatRuntimeReady ||
			status.RuntimeWorkerID != "runtime-broadcast" ||
			status.RuntimeActiveRunCount != 2 {
			t.Fatalf("runtime status broadcast = %#v", status)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for runtime status broadcast")
	}

	// A heartbeat with identical semantic state only refreshes the internal TTL
	// and must not spam every subscribed WebSocket.
	sm.UpdateRuntimeStatus(sess, &gatewayv1.RuntimeStatusEvent{
		WorkerId:       "runtime-broadcast",
		State:          "ready",
		Visible:        true,
		ActiveRunCount: 2,
		Timestamp:      time.Now().Unix(),
	})
	select {
	case duplicate := <-updates:
		t.Fatalf("timestamp-only runtime heartbeat was broadcast: %#v", duplicate)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestDispatchFromStaleSessionIsIgnored(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	first := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(first)
	second := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(second)

	ch, done, cleanup, err := sm.RegisterStream("request-1")
	if err != nil {
		t.Fatalf("RegisterStream: %v", err)
	}
	defer cleanup()

	staleEnv := &gatewayv1.AgentEnvelope{
		RequestId: "request-1",
		Payload: &gatewayv1.AgentEnvelope_Error{
			Error: &gatewayv1.ErrorResponse{Code: 500, Message: "stale"},
		},
	}
	sm.DispatchFromAgentForSession(first, staleEnv)
	select {
	case got := <-ch:
		t.Fatalf("received stale session envelope: %#v", got)
	case <-done:
		t.Fatalf("stream closed while current session is still active")
	case <-time.After(50 * time.Millisecond):
	}

	currentEnv := &gatewayv1.AgentEnvelope{
		RequestId: "request-1",
		Payload: &gatewayv1.AgentEnvelope_Error{
			Error: &gatewayv1.ErrorResponse{Code: 500, Message: "current"},
		},
	}
	sm.DispatchFromAgentForSession(second, currentEnv)
	select {
	case got := <-ch:
		if got.GetError().GetMessage() != "current" {
			t.Fatalf("error message = %q, want current", got.GetError().GetMessage())
		}
	case <-done:
		t.Fatalf("stream closed before current session dispatch")
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for current session envelope")
	}
}

func TestSendToAgentUnblocksWhenSessionCloses(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sess := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(sess)

	errCh := make(chan error, 1)
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				errCh <- fmt.Errorf("panic: %v", recovered)
			}
		}()
		for i := 0; i < 128; i += 1 {
			_ = sm.SendToAgent(&gatewayv1.GatewayEnvelope{RequestId: fmt.Sprintf("request-%d", i)})
		}
		errCh <- nil
	}()

	time.Sleep(10 * time.Millisecond)
	sm.ClearSession(sess)

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatalf("SendToAgent did not unblock after session close")
	}
}

func TestSendToAgentContextTimeoutKeepsSessionAlive(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sess := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(sess)

	for i := 0; i < cap(sess.Outbound()); i += 1 {
		if err := sm.SendToAgent(&gatewayv1.GatewayEnvelope{RequestId: fmt.Sprintf("queued-%d", i)}); err != nil {
			t.Fatalf("prime outbound queue: %v", err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	err := sm.SendToAgentContext(ctx, &gatewayv1.GatewayEnvelope{RequestId: "blocked"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("SendToAgentContext with full queue = %v, want context deadline exceeded", err)
	}
	if status := sm.Status(); !status.Online {
		t.Fatalf("status online = false after SendToAgentContext timeout; congestion must not kill the session")
	}
	select {
	case <-sess.Done():
		t.Fatalf("session closed after SendToAgentContext timeout")
	default:
	}
}

func TestSendPingBypassesFullOutboundQueue(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sess := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(sess)

	for i := 0; i < cap(sess.Outbound()); i += 1 {
		if err := sm.SendToAgent(&gatewayv1.GatewayEnvelope{RequestId: fmt.Sprintf("queued-%d", i)}); err != nil {
			t.Fatalf("prime outbound queue: %v", err)
		}
	}

	if err := sess.SendPing(&gatewayv1.GatewayEnvelope{RequestId: "ping-1"}); err != nil {
		t.Fatalf("SendPing with full outbound queue: %v", err)
	}
	if err := sess.SendPing(&gatewayv1.GatewayEnvelope{RequestId: "ping-2"}); err != nil {
		t.Fatalf("SendPing replacing queued ping: %v", err)
	}

	select {
	case ping := <-sess.Pings():
		if ping.GetRequestId() != "ping-2" {
			t.Fatalf("queued ping = %q, want latest ping-2", ping.GetRequestId())
		}
	default:
		t.Fatalf("no ping queued on the dedicated lane")
	}

	sess.Close()
	if err := sess.SendPing(&gatewayv1.GatewayEnvelope{RequestId: "ping-3"}); !errors.Is(err, session.ErrAgentOffline) {
		t.Fatalf("SendPing after close = %v, want ErrAgentOffline", err)
	}
}

func TestChatQueueEventsReplayLatestSnapshotToNewSubscribers(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sm.SetSession(session.NewAgentSession(sm.LatestAuthSnapshot()))
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "queue-event-1",
		Payload: &gatewayv1.AgentEnvelope_ChatQueueEvent{
			ChatQueueEvent: &gatewayv1.ChatQueueEvent{
				ConversationId: " conversation-1 ",
				SnapshotJson:   `{"conversationId":"conversation-1","revision":2,"items":[{"id":"queue-1"}]}`,
				Revision:       2,
			},
		},
	})
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "queue-event-stale",
		Payload: &gatewayv1.AgentEnvelope_ChatQueueEvent{
			ChatQueueEvent: &gatewayv1.ChatQueueEvent{
				ConversationId: "conversation-1",
				SnapshotJson:   `{"conversationId":"conversation-1","revision":1,"items":[]}`,
				Revision:       1,
			},
		},
	})
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "queue-event-zero",
		Payload: &gatewayv1.AgentEnvelope_ChatQueueEvent{
			ChatQueueEvent: &gatewayv1.ChatQueueEvent{
				ConversationId: "conversation-1",
				SnapshotJson:   `{"conversationId":"conversation-1","revision":0,"items":[]}`,
				Revision:       0,
			},
		},
	})

	cached, ok := sm.ChatQueueSnapshot("conversation-1")
	if !ok || cached.GetRevision() != 2 || !strings.Contains(cached.GetSnapshotJson(), "queue-1") {
		t.Fatalf("cached queue snapshot = %#v ok=%v, want revision 2 with queue-1", cached, ok)
	}

	events, cleanup := sm.SubscribeChatQueueEvents()
	defer cleanup()
	select {
	case event := <-events:
		if event.GetConversationId() != "conversation-1" ||
			event.GetRevision() != 2 ||
			!strings.Contains(event.GetSnapshotJson(), "queue-1") {
			t.Fatalf("replayed queue snapshot = %#v, want latest revision 2", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for replayed queue snapshot")
	}
}

func TestChatQueueSnapshotAllowsNewSessionToResetRevision(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sm.SetSession(session.NewAgentSession(sm.LatestAuthSnapshot()))
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "queue-event-1",
		Payload: &gatewayv1.AgentEnvelope_ChatQueueEvent{
			ChatQueueEvent: &gatewayv1.ChatQueueEvent{
				ConversationId: "conversation-1",
				SnapshotJson:   `{"conversationId":"conversation-1","revision":5,"items":[{"id":"queue-1"}]}`,
				Revision:       5,
			},
		},
	})

	sm.SetSession(session.NewAgentSession(sm.LatestAuthSnapshot()))
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "queue-event-reset",
		Payload: &gatewayv1.AgentEnvelope_ChatQueueEvent{
			ChatQueueEvent: &gatewayv1.ChatQueueEvent{
				ConversationId: "conversation-1",
				SnapshotJson:   `{"conversationId":"conversation-1","revision":0,"items":[]}`,
				Revision:       0,
			},
		},
	})

	cached, ok := sm.ChatQueueSnapshot("conversation-1")
	if !ok || cached.GetRevision() != 0 || strings.Contains(cached.GetSnapshotJson(), "queue-1") {
		t.Fatalf("cached queue snapshot after new session = %#v ok=%v, want empty revision 0", cached, ok)
	}
}

func dispatchChatToken(sm *session.Manager, requestID string, conversationID string, text string) {
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: requestID,
		Payload: &gatewayv1.AgentEnvelope_ChatEvent{
			ChatEvent: &gatewayv1.ChatEvent{
				Type:           gatewayv1.ChatEvent_TOKEN,
				ConversationId: conversationID,
				Data:           fmt.Sprintf(`{"text":%q}`, text),
			},
		},
	})
}

func dispatchChatDone(sm *session.Manager, requestID string, conversationID string) {
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: requestID,
		Payload: &gatewayv1.AgentEnvelope_ChatEvent{
			ChatEvent: &gatewayv1.ChatEvent{
				Type:           gatewayv1.ChatEvent_DONE,
				ConversationId: conversationID,
				Data:           "{}",
			},
		},
	})
}

func TestConversationStreamSeqContinuesAcrossDispatchedRuns(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sm.SetSession(session.NewAgentSession(sm.LatestAuthSnapshot()))

	dispatchChatControl(sm, "run-1", "conversation-1", "started", "running")
	dispatchChatToken(sm, "run-1", "conversation-1", "first")
	dispatchChatDone(sm, "run-1", "conversation-1")
	dispatchChatControl(sm, "run-2", "conversation-1", "started", "running")
	dispatchChatToken(sm, "run-2", "conversation-1", "second")

	sub := sm.SubscribeConversationStream("conversation-1", 0, "")
	defer sub.Cleanup()

	var lastSeq int64
	runFinished := 0
	for _, event := range sub.Events {
		if event.Seq <= lastSeq {
			t.Fatalf("seq regressed: %d after %d", event.Seq, lastSeq)
		}
		lastSeq = event.Seq
		if event.Type == "run_finished" {
			runFinished++
		}
	}
	if runFinished != 1 {
		t.Fatalf("run_finished events = %d, want 1", runFinished)
	}
	if sub.Activity == nil || sub.Activity.RunID != "run-2" {
		t.Fatalf("activity = %#v, want run-2", sub.Activity)
	}
}

func TestDispatchedHistoryRunningIdleAreDropped(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sm.SetSession(session.NewAgentSession(sm.LatestAuthSnapshot()))

	historyEvents, cleanup := sm.SubscribeHistorySync()
	defer cleanup()

	for _, kind := range []string{"running", "idle"} {
		sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
			RequestId: "history-sync",
			Payload: &gatewayv1.AgentEnvelope_HistorySync{
				HistorySync: &gatewayv1.HistorySyncEvent{
					Kind:           kind,
					ConversationId: "conversation-1",
				},
			},
		})
	}

	select {
	case event := <-historyEvents:
		t.Fatalf("agent running/idle history event should be dropped, got %#v", event)
	case <-time.After(50 * time.Millisecond):
	}
	if activities := sm.ActiveConversationActivities(); len(activities) != 0 {
		t.Fatalf("history running must not create activity, got %#v", activities)
	}

	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "history-sync",
		Payload: &gatewayv1.AgentEnvelope_HistorySync{
			HistorySync: &gatewayv1.HistorySyncEvent{
				Kind:           "upsert",
				ConversationId: "conversation-1",
				Conversation:   &gatewayv1.ConversationSummary{Id: "conversation-1"},
			},
		},
	})
	select {
	case event := <-historyEvents:
		if event.GetKind() != "upsert" {
			t.Fatalf("history event kind = %q, want upsert", event.GetKind())
		}
	case <-time.After(time.Second):
		t.Fatalf("upsert history event was not forwarded")
	}
}

func TestAgentDisconnectPreservesActiveConversationActivity(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sess := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(sess)

	dispatchChatControl(sm, "run-1", "conversation-1", "started", "running")
	sm.ClearSession(sess)

	activities := sm.ActiveConversationActivities()
	if len(activities) != 1 || activities[0].RunID != "run-1" {
		t.Fatalf("activities after disconnect = %#v, want run-1 preserved", activities)
	}
}

func TestTerminalSnapshotFinishesRunAndStaleRunningIsIgnored(t *testing.T) {
	t.Parallel()

	sm := newTestSessionManager()
	sm.SetSession(session.NewAgentSession(sm.LatestAuthSnapshot()))

	dispatchChatControl(sm, "run-1", "conversation-1", "started", "running")
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "run-1",
		Payload: &gatewayv1.AgentEnvelope_ChatRuntimeSnapshot{
			ChatRuntimeSnapshot: &gatewayv1.ChatRuntimeSnapshot{
				RunId:          "run-1",
				ConversationId: "conversation-1",
				State:          "completed",
			},
		},
	})
	if activities := sm.ActiveConversationActivities(); len(activities) != 0 {
		t.Fatalf("terminal snapshot should clear activity, got %#v", activities)
	}

	// A stale "running" snapshot after the terminal must not resurrect the run.
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "run-1",
		Payload: &gatewayv1.AgentEnvelope_ChatRuntimeSnapshot{
			ChatRuntimeSnapshot: &gatewayv1.ChatRuntimeSnapshot{
				RunId:          "run-1",
				ConversationId: "conversation-1",
				State:          "running",
			},
		},
	})
	if activities := sm.ActiveConversationActivities(); len(activities) != 0 {
		t.Fatalf("stale running snapshot resurrected the run: %#v", activities)
	}

	sub := sm.SubscribeConversationStream("conversation-1", 0, "")
	defer sub.Cleanup()
	finished := 0
	for _, event := range sub.Events {
		if event.Type == "run_finished" {
			finished++
		}
	}
	if finished != 1 {
		t.Fatalf("run_finished events = %d, want exactly 1", finished)
	}
}
