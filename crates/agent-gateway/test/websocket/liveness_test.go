package websocket_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/liveagent/agent-gateway/internal/config"
	"github.com/liveagent/agent-gateway/internal/server"
	"github.com/liveagent/agent-gateway/internal/session"
)

// idleTimeout = 3*100ms + 200ms = 500ms for every test in this file.
func newLivenessWebSocketTest(t *testing.T) (*session.Manager, *websocket.Conn, func()) {
	t.Helper()

	sm := session.NewManager()
	handler := server.NewWebSocketServer(&config.Config{
		Token:                    "ws-token",
		RequestTimeout:           time.Second,
		WebSocketHeartbeatPeriod: 100 * time.Millisecond,
		WebSocketHeartbeatGrace:  200 * time.Millisecond,
		WebSocketWriteTimeout:    time.Second,
	}, sm)
	conn, cleanup := dialGatewayWebSocket(t, handler)
	authWebSocket(t, conn, "ws-token")
	return sm, conn, cleanup
}

func receiveStatusEvent(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	for attempt := 0; attempt < 64; attempt++ {
		if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
			t.Fatalf("set websocket read deadline: %v", err)
		}
		var env wsEnvelope
		if err := conn.ReadJSON(&env); err != nil {
			t.Fatalf("receive status.event: %v", err)
		}
		if env.Type != "status.event" {
			continue
		}
		payload := map[string]any{}
		if len(env.Payload) > 0 {
			if err := json.Unmarshal(env.Payload, &payload); err != nil {
				t.Fatalf("decode status.event payload: %v", err)
			}
		}
		return payload
	}
	t.Fatal("timed out waiting for status.event")
	return nil
}

// A frozen background tab stops running JS — no JSON pongs, no requests — but
// the browser's network stack keeps answering protocol pings. Gorilla's
// default ping handler reproduces exactly that, so a client that only ever
// reads must survive well past the idle timeout.
func TestProtocolPongOnlyClientSurvivesIdleTimeout(t *testing.T) {
	t.Parallel()

	_, conn, cleanup := newLivenessWebSocketTest(t)
	defer cleanup()

	silentUntil := time.Now().Add(2 * time.Second) // 4x the 500ms idle timeout
	for time.Now().Before(silentUntil) {
		if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
			t.Fatalf("set websocket read deadline: %v", err)
		}
		var env wsEnvelope
		if err := conn.ReadJSON(&env); err != nil {
			t.Fatalf("connection dropped during the silent window: %v", err)
		}
	}

	sendEnvelope(t, conn, "status-1", "status.get", map[string]any{})
	env := receiveEnvelopeWithID(t, conn, "status-1")
	if env.Type != "response" {
		t.Fatalf("status.get after silent window = %#v, want response", env)
	}
}

// A client that answers nothing — not even protocol pings — is a dead link
// and must still be reaped promptly.
func TestUnresponsiveClientIsEvictedAfterIdleTimeout(t *testing.T) {
	t.Parallel()

	_, conn, cleanup := newLivenessWebSocketTest(t)
	defer cleanup()

	conn.SetPingHandler(func(string) error { return nil })

	evicted := make(chan struct{}, 1)
	go func() {
		for {
			_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
			var env wsEnvelope
			if err := conn.ReadJSON(&env); err != nil {
				evicted <- struct{}{}
				return
			}
		}
	}()

	select {
	case <-evicted:
	case <-time.After(3 * time.Second):
		t.Fatal("server did not evict a client that stopped answering pings")
	}
}

// Agent connect/disconnect must reach web clients as pushed status.event
// frames (the client's poll is only a slow fallback).
func TestStatusEventPushedOnAgentSessionChanges(t *testing.T) {
	t.Parallel()

	sm, conn, cleanup := newLivenessWebSocketTest(t)
	defer cleanup()

	initial := receiveStatusEvent(t, conn)
	if online, _ := initial["online"].(bool); online {
		t.Fatalf("initial replayed status.event online = true, want false")
	}

	sm.RecordAuthentication("desktop-agent", "0.9.0", "session-1")
	agentSession := session.NewAgentSession(sm.LatestAuthSnapshot())
	sm.SetSession(agentSession)
	connected := receiveStatusEvent(t, conn)
	if online, _ := connected["online"].(bool); !online {
		t.Fatalf("status.event after SetSession = %#v, want online=true", connected)
	}

	sm.ClearSession(agentSession)
	deadline := time.Now().Add(2 * time.Second)
	for {
		got := receiveStatusEvent(t, conn)
		if online, _ := got["online"].(bool); !online {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("status.event online=false not pushed after ClearSession")
		}
	}
}
