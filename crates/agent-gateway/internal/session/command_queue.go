package session

import (
	"context"
	"sync"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

const (
	defaultCommandQueueTimeout = 30 * time.Second
	maxCommandQueueSize        = 10
)

type pendingCommand struct {
	envelope *gatewayv1.GatewayEnvelope
	result   chan error
	deadline time.Time
}

type commandQueue struct {
	mu      sync.Mutex
	items   []pendingCommand
	timeout time.Duration
}

func newCommandQueue(timeout time.Duration) *commandQueue {
	if timeout <= 0 {
		timeout = defaultCommandQueueTimeout
	}
	return &commandQueue{
		timeout: timeout,
	}
}

func (q *commandQueue) Enqueue(ctx context.Context, env *gatewayv1.GatewayEnvelope) error {
	q.mu.Lock()
	q.evictExpiredLocked()
	if len(q.items) >= maxCommandQueueSize {
		q.mu.Unlock()
		return ErrCommandQueueFull
	}
	resultCh := make(chan error, 1)
	q.items = append(q.items, pendingCommand{
		envelope: env,
		result:   resultCh,
		deadline: time.Now().Add(q.timeout),
	})
	q.mu.Unlock()

	select {
	case err := <-resultCh:
		return err
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(q.timeout):
		return ErrCommandQueueTimeout
	}
}

func (q *commandQueue) DrainTo(session *AgentSession) {
	q.mu.Lock()
	items := q.items
	q.items = nil
	q.mu.Unlock()

	now := time.Now()
	for _, cmd := range items {
		if now.After(cmd.deadline) {
			select {
			case cmd.result <- ErrCommandQueueTimeout:
			default:
			}
			continue
		}
		ctx, cancel := context.WithDeadline(context.Background(), cmd.deadline)
		err := session.SendToAgentContext(ctx, cmd.envelope)
		cancel()
		select {
		case cmd.result <- err:
		default:
		}
	}
}

func (q *commandQueue) FailAll(err error) {
	q.mu.Lock()
	items := q.items
	q.items = nil
	q.mu.Unlock()

	for _, cmd := range items {
		select {
		case cmd.result <- err:
		default:
		}
	}
}

func (q *commandQueue) evictExpiredLocked() {
	now := time.Now()
	n := 0
	for _, cmd := range q.items {
		if now.After(cmd.deadline) {
			select {
			case cmd.result <- ErrCommandQueueTimeout:
			default:
			}
			continue
		}
		q.items[n] = cmd
		n++
	}
	q.items = q.items[:n]
}
