package server

import (
	"errors"
	"testing"
	"time"
)

func newEnqueueTestConnection(outboxSize int, writeTimeout time.Duration) *websocketConnection {
	return &websocketConnection{
		outbox:       make(chan websocketEnvelope, outboxSize),
		ctrlOutbox:   make(chan websocketEnvelope, websocketControlQueueSize),
		writeTimeout: writeTimeout,
		done:         make(chan struct{}),
	}
}

func TestEnqueueEnvelopeWaitsForDrainedSlot(t *testing.T) {
	t.Parallel()

	c := newEnqueueTestConnection(1, 500*time.Millisecond)
	c.outbox <- websocketEnvelope{Type: "ping"}

	go func() {
		time.Sleep(10 * time.Millisecond)
		<-c.outbox
	}()

	if err := c.enqueueEnvelope(websocketEnvelope{Type: "chat.event"}); err != nil {
		t.Fatalf("enqueueEnvelope with draining outbox = %v, want nil", err)
	}
}

func TestEnqueueEnvelopeFailsAfterPersistentBacklog(t *testing.T) {
	t.Parallel()

	c := newEnqueueTestConnection(1, 50*time.Millisecond)
	c.outbox <- websocketEnvelope{Type: "ping"}

	started := time.Now()
	err := c.enqueueEnvelope(websocketEnvelope{Type: "chat.event"})
	if !errors.Is(err, errWriteQueueFull) {
		t.Fatalf("enqueueEnvelope with stuck outbox = %v, want errWriteQueueFull", err)
	}
	if waited := time.Since(started); waited < 50*time.Millisecond {
		t.Fatalf("enqueueEnvelope gave up after %s, want at least the 50ms write timeout", waited)
	}
}

func TestEnqueueEnvelopeReturnsWhenConnectionCloses(t *testing.T) {
	t.Parallel()

	c := newEnqueueTestConnection(1, time.Second)
	c.outbox <- websocketEnvelope{Type: "ping"}

	go func() {
		time.Sleep(10 * time.Millisecond)
		close(c.done)
	}()

	err := c.enqueueEnvelope(websocketEnvelope{Type: "chat.event"})
	if err == nil || err.Error() != "connection closed" {
		t.Fatalf("enqueueEnvelope on closed connection = %v, want connection closed", err)
	}
}

func TestWriteEnvelopeRoutesControlTypesToControlQueue(t *testing.T) {
	t.Parallel()

	c := newEnqueueTestConnection(1, 50*time.Millisecond)

	for _, envelopeType := range []string{"ping", "error", "chat.subscription_reset", "chat.command_update"} {
		if err := c.writeEnvelope(websocketEnvelope{Type: envelopeType}); err != nil {
			t.Fatalf("writeEnvelope(%q) = %v, want nil", envelopeType, err)
		}
	}
	if got := len(c.ctrlOutbox); got != 4 {
		t.Fatalf("control queue depth = %d, want 4", got)
	}
	if got := len(c.outbox); got != 0 {
		t.Fatalf("data queue depth = %d, want 0", got)
	}

	if err := c.writeEnvelope(websocketEnvelope{Type: "chat.event"}); err != nil {
		t.Fatalf("writeEnvelope(chat.event) = %v, want nil", err)
	}
	if got := len(c.outbox); got != 1 {
		t.Fatalf("data queue depth after chat.event = %d, want 1", got)
	}
}

func TestWritePriorityResponseUsesControlQueue(t *testing.T) {
	t.Parallel()

	c := newEnqueueTestConnection(1, 50*time.Millisecond)
	c.outbox <- websocketEnvelope{Type: "chat.event"}

	if err := c.writePriorityResponse("cmd-1", map[string]any{"run_id": "run-1"}); err != nil {
		t.Fatalf("writePriorityResponse: %v", err)
	}
	select {
	case envelope := <-c.ctrlOutbox:
		if envelope.ID != "cmd-1" || envelope.Type != "response" || !envelope.priority {
			t.Fatalf("priority response envelope = %#v", envelope)
		}
	default:
		t.Fatal("priority response was not routed to the control queue")
	}
}

func TestWriteEnvelopeQueueFullDoesNotCloseConnection(t *testing.T) {
	t.Parallel()

	c := newEnqueueTestConnection(1, 20*time.Millisecond)
	c.outbox <- websocketEnvelope{Type: "chat.event"}

	err := c.writeEnvelope(websocketEnvelope{Type: "chat.event"})
	if !errors.Is(err, errWriteQueueFull) {
		t.Fatalf("writeEnvelope with stuck outbox = %v, want errWriteQueueFull", err)
	}
	select {
	case <-c.done:
		t.Fatal("writeEnvelope closed the connection on a full data queue")
	default:
	}
	if got := c.droppedFrames.Load(); got != 1 {
		t.Fatalf("droppedFrames = %d, want 1", got)
	}
}

func TestWriteResponseQueueFullClosesConnectionForRecovery(t *testing.T) {
	t.Parallel()

	c := newEnqueueTestConnection(1, 20*time.Millisecond)
	c.outbox <- websocketEnvelope{Type: "chat.event"}

	err := c.writeResponse("history-1", map[string]any{"total_count": 1})
	if !errors.Is(err, errWriteQueueFull) {
		t.Fatalf("writeResponse with stuck outbox = %v, want errWriteQueueFull", err)
	}
	select {
	case <-c.done:
		// Expected: the client observes a disconnect and can recover the
		// correlated request instead of waiting for a silently dropped reply.
	default:
		t.Fatal("writeResponse left the connection open after dropping a correlated response")
	}
}

func TestEnqueueControlEnvelopeDropsPingWhenFull(t *testing.T) {
	t.Parallel()

	c := newEnqueueTestConnection(1, time.Second)
	for range websocketControlQueueSize {
		c.ctrlOutbox <- websocketEnvelope{Type: "error"}
	}

	started := time.Now()
	if err := c.writeEnvelope(websocketEnvelope{Type: "ping"}); err != nil {
		t.Fatalf("writeEnvelope(ping) with full control queue = %v, want nil (dropped)", err)
	}
	if waited := time.Since(started); waited > 100*time.Millisecond {
		t.Fatalf("ping enqueue blocked for %s, want immediate drop", waited)
	}
	if got := c.droppedFrames.Load(); got != 1 {
		t.Fatalf("droppedFrames = %d, want 1", got)
	}
	select {
	case <-c.done:
		t.Fatal("dropped ping closed the connection")
	default:
	}
}
