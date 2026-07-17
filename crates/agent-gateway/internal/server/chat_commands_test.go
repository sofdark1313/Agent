package server

import (
	"context"
	"testing"
	"time"

	"github.com/liveagent/agent-gateway/internal/config"
	"github.com/liveagent/agent-gateway/internal/handler"
	"github.com/liveagent/agent-gateway/internal/session"
)

func newChatCommandTestManager(t *testing.T) (*session.Manager, *session.AgentSession) {
	t.Helper()
	sm := session.NewManager()
	sm.RecordAuthentication("desktop-agent", "test", "session-test")
	sess := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(sess)
	t.Cleanup(func() { sm.ClearSession(sess) })
	return sm, sess
}

func TestChatTimeoutDefaultsAreShortAndDedicated(t *testing.T) {
	t.Parallel()

	if got := chatPrepareTimeout(nil); got != 2*time.Second {
		t.Fatalf("chatPrepareTimeout(nil) = %s, want 2s", got)
	}
	if got := chatDeliveryTimeout(nil); got != 5*time.Second {
		t.Fatalf("chatDeliveryTimeout(nil) = %s, want 5s", got)
	}
	if got := chatStartTimeout(nil); got != 5*time.Second {
		t.Fatalf("chatStartTimeout(nil) = %s, want 5s", got)
	}
	if got := chatRenderStartTimeout(nil); got != 10*time.Second {
		t.Fatalf("chatRenderStartTimeout(nil) = %s, want 10s", got)
	}
}

func TestDispatchAcceptedChatCommandUsesDeliveryTimeout(t *testing.T) {
	t.Parallel()

	sm, _ := newChatCommandTestManager(t)
	start := sm.StartChatCommand("run-delivery-timeout", "conv-1", "", "client-1", nil)
	cfg := &config.Config{ChatDeliveryTimeout: 30 * time.Millisecond}
	body := handler.ChatRequestBody{
		ConversationID:  "conv-1",
		ClientRequestID: "client-1",
		Message:         "hello",
	}

	startedAt := time.Now()
	dispatchAcceptedChatCommand(
		context.Background(), cfg, sm, nil, start, body, nil, "trace-delivery-timeout",
	)
	elapsed := time.Since(startedAt)
	if elapsed < 20*time.Millisecond || elapsed > 500*time.Millisecond {
		t.Fatalf("delivery timeout elapsed = %s, want about 30ms", elapsed)
	}

	sub := sm.SubscribeConversationStream("conv-1", 0, "")
	defer sub.Cleanup()
	if len(sub.Events) == 0 {
		t.Fatal("delivery timeout did not terminalize the accepted run")
	}
	last := sub.Events[len(sub.Events)-1]
	if last.Type != session.StreamEventRunFinished ||
		last.Payload["error_code"] != "desktop_runtime_unavailable" {
		t.Fatalf("delivery timeout terminal = %s %#v", last.Type, last.Payload)
	}
}

func TestChatStartupWatchdogUsesShortCombinedWindow(t *testing.T) {
	t.Parallel()

	sm, _ := newChatCommandTestManager(t)
	sm.StartChatCommand("run-start-timeout", "conv-1", "", "client-1", nil)
	cfg := &config.Config{
		ChatStartTimeout:       15 * time.Millisecond,
		ChatRenderStartTimeout: 20 * time.Millisecond,
	}

	startedAt := time.Now()
	watchAcceptedChatCommandStartup(context.Background(), cfg, sm, "run-start-timeout")
	elapsed := time.Since(startedAt)
	if elapsed < 25*time.Millisecond || elapsed > 500*time.Millisecond {
		t.Fatalf("startup watchdog elapsed = %s, want about 35ms", elapsed)
	}

	sub := sm.SubscribeConversationStream("conv-1", 0, "")
	defer sub.Cleanup()
	last := sub.Events[len(sub.Events)-1]
	if last.Type != session.StreamEventRunFinished || last.Payload["error_code"] != "startup_timeout" {
		t.Fatalf("startup watchdog terminal = %s %#v", last.Type, last.Payload)
	}
}
