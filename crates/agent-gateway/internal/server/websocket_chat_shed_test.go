package server

import (
	"encoding/json"
	"testing"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/session"
)

// A congested data queue must shed the chat subscription (reset rides the
// control queue so the client can resync by after_seq) and leave the
// connection itself untouched.
func TestForwardConversationEventsShedsSubscriptionOnQueueFull(t *testing.T) {
	t.Parallel()

	sm := session.NewManager()
	sm.RecordAuthentication("desktop-agent", "0.9.0", "session-shed")
	sm.SetSession(session.NewAgentSession(sm.LatestAuthSnapshot()))
	c := &websocketConnection{
		sm:           sm,
		outbox:       make(chan websocketEnvelope, 1),
		ctrlOutbox:   make(chan websocketEnvelope, websocketControlQueueSize),
		writeTimeout: 30 * time.Millisecond,
		done:         make(chan struct{}),
	}
	// Congest the data queue with nothing draining it.
	c.outbox <- websocketEnvelope{Type: "chat.event"}

	sub := sm.SubscribeConversationStream("conv-shed", 0, "")
	forwarderDone := make(chan struct{})
	go func() {
		defer close(forwarderDone)
		c.forwardConversationEvents("conv-shed", sub)
	}()

	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "run-shed",
		Payload: &gatewayv1.AgentEnvelope_ChatControl{
			ChatControl: &gatewayv1.ChatControlEvent{
				RequestId:      "run-shed",
				ConversationId: "conv-shed",
				Type:           "started",
				State:          "running",
			},
		},
	})
	tokenData, _ := json.Marshal(map[string]any{"text": "hello"})
	sm.DispatchFromAgent(&gatewayv1.AgentEnvelope{
		RequestId: "run-shed",
		Payload: &gatewayv1.AgentEnvelope_ChatEvent{
			ChatEvent: &gatewayv1.ChatEvent{
				Type:           gatewayv1.ChatEvent_TOKEN,
				ConversationId: "conv-shed",
				Data:           string(tokenData),
			},
		},
	})

	select {
	case env := <-c.ctrlOutbox:
		if env.Type != "chat.subscription_reset" {
			t.Fatalf("control envelope type = %q, want chat.subscription_reset", env.Type)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for chat.subscription_reset on the control queue")
	}

	select {
	case <-forwarderDone:
	case <-time.After(2 * time.Second):
		t.Fatal("forwarder did not exit after shedding the subscription")
	}

	select {
	case <-c.done:
		t.Fatal("shedding a congested chat subscription closed the connection")
	default:
	}
}
