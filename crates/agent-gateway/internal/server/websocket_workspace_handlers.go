package server

import (
	"errors"
	"strings"
	"sync"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

// workspaceActivitySubscription is one workdir subscription on a websocket
// connection. It ends on workspace.unsubscribe, a replacing
// workspace.subscribe for the same workdir, or connection close.
type workspaceActivitySubscription struct {
	cancel func()
	done   chan struct{}
	once   sync.Once
}

func (s *workspaceActivitySubscription) close() {
	s.once.Do(func() {
		close(s.done)
		s.cancel()
	})
}

func (c *websocketConnection) handleWorkspaceSubscribe(req websocketRequest) {
	var payload struct {
		Workdir string `json:"workdir"`
	}
	if err := decodeWebSocketPayload(req.Payload, &payload); err != nil {
		_ = c.writeError(req.ID, "invalid workspace.subscribe payload")
		return
	}
	workdir := strings.TrimSpace(payload.Workdir)
	if workdir == "" {
		_ = c.writeError(req.ID, "workdir is required")
		return
	}

	events, cancel := c.sm.SubscribeWorkspaceActivity(workdir)
	sub := &workspaceActivitySubscription{
		cancel: cancel,
		done:   make(chan struct{}),
	}

	c.workspaceSubsMu.Lock()
	if c.workspaceSubs == nil {
		c.workspaceSubs = make(map[string]*workspaceActivitySubscription)
	}
	if previous := c.workspaceSubs[workdir]; previous != nil {
		previous.close()
	}
	c.workspaceSubs[workdir] = sub
	c.workspaceSubsMu.Unlock()

	if err := c.writeResponse(req.ID, map[string]any{"ok": true}); err != nil {
		sub.close()
		return
	}

	go c.forwardWorkspaceActivity(sub, events)
}

func (c *websocketConnection) forwardWorkspaceActivity(
	sub *workspaceActivitySubscription,
	events <-chan *gatewayv1.WorkspaceActivityEvent,
) {
	for {
		select {
		case <-c.done:
			return
		case <-sub.done:
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			if err := c.writeEvent("workspace.activity", websocketWorkspaceActivityPayload(event)); err != nil {
				if errors.Is(err, errWriteQueueFull) {
					continue
				}
				return
			}
		}
	}
}

func (c *websocketConnection) handleWorkspaceUnsubscribe(req websocketRequest) {
	var payload struct {
		Workdir string `json:"workdir"`
	}
	if err := decodeWebSocketPayload(req.Payload, &payload); err != nil {
		_ = c.writeError(req.ID, "invalid workspace.unsubscribe payload")
		return
	}
	workdir := strings.TrimSpace(payload.Workdir)

	c.workspaceSubsMu.Lock()
	if sub := c.workspaceSubs[workdir]; sub != nil {
		sub.close()
		delete(c.workspaceSubs, workdir)
	}
	c.workspaceSubsMu.Unlock()

	_ = c.writeResponse(req.ID, map[string]any{"ok": true})
}

func (c *websocketConnection) cleanupWorkspaceSubscriptions() {
	c.workspaceSubsMu.Lock()
	for workdir, sub := range c.workspaceSubs {
		sub.close()
		delete(c.workspaceSubs, workdir)
	}
	c.workspaceSubsMu.Unlock()
}

func websocketWorkspaceActivityPayload(event *gatewayv1.WorkspaceActivityEvent) map[string]any {
	changedPaths := event.GetChangedPaths()
	if changedPaths == nil {
		changedPaths = []string{}
	}
	return map[string]any{
		"workdir":      event.GetWorkdir(),
		"revision":     event.GetRevision(),
		"fs":           event.GetFs(),
		"git":          event.GetGit(),
		"changedPaths": changedPaths,
		"truncated":    event.GetTruncated(),
	}
}
