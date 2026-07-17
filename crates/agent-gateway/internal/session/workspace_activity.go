package session

import (
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

const workspaceActivityChannelDepth = 16

// workspaceActivityHub tracks which workdirs /ws clients are interested in and
// fans agent-reported activity events out to them. The union of watched
// workdirs is pushed to the agent as a declarative full set whenever it
// changes (and on agent reconnect), so the agent owns zero subscription state.
type workspaceActivityHub struct {
	mu          sync.Mutex
	watchCounts map[string]int
	nextSubID   int
	subscribers map[int]*workspaceActivitySubscriber
}

type workspaceActivitySubscriber struct {
	workdir string
	ch      chan *gatewayv1.WorkspaceActivityEvent
}

func newWorkspaceActivityHub() *workspaceActivityHub {
	return &workspaceActivityHub{
		watchCounts: make(map[string]int),
		subscribers: make(map[int]*workspaceActivitySubscriber),
	}
}

// SubscribeWorkspaceActivity registers interest in one workdir. The returned
// cleanup drops the subscription; when the workdir's refcount reaches zero it
// leaves the agent-side watch set on the next push.
func (m *Manager) SubscribeWorkspaceActivity(
	workdir string,
) (<-chan *gatewayv1.WorkspaceActivityEvent, func()) {
	workdir = strings.TrimSpace(workdir)
	sub := &workspaceActivitySubscriber{
		workdir: workdir,
		ch:      make(chan *gatewayv1.WorkspaceActivityEvent, workspaceActivityChannelDepth),
	}

	m.workspaceHub.mu.Lock()
	subID := m.workspaceHub.nextSubID
	m.workspaceHub.nextSubID += 1
	m.workspaceHub.subscribers[subID] = sub
	m.workspaceHub.watchCounts[workdir] += 1
	watchSetChanged := m.workspaceHub.watchCounts[workdir] == 1
	m.workspaceHub.mu.Unlock()

	if watchSetChanged {
		m.pushWorkspaceWatchSet()
	}

	var once sync.Once
	cleanup := func() {
		once.Do(func() {
			m.workspaceHub.mu.Lock()
			// Do not close the channel: broadcastWorkspaceActivity sends after
			// copying subscribers, so closing can race with an in-flight send.
			delete(m.workspaceHub.subscribers, subID)
			changed := false
			if count := m.workspaceHub.watchCounts[workdir]; count > 1 {
				m.workspaceHub.watchCounts[workdir] = count - 1
			} else {
				delete(m.workspaceHub.watchCounts, workdir)
				changed = true
			}
			m.workspaceHub.mu.Unlock()
			if changed {
				m.pushWorkspaceWatchSet()
			}
		})
	}
	return sub.ch, cleanup
}

// broadcastWorkspaceActivity fans one agent event out to the subscribers of
// its workdir. Runs on the agent gRPC read loop, so it must never block: a
// full subscriber channel drops the event (consumers converge on the next
// one, and revision gaps are already tolerated client-side).
func (m *Manager) broadcastWorkspaceActivity(event *gatewayv1.WorkspaceActivityEvent) {
	if event == nil {
		return
	}
	workdir := strings.TrimSpace(event.GetWorkdir())
	if workdir == "" {
		return
	}

	m.workspaceHub.mu.Lock()
	targets := make([]chan *gatewayv1.WorkspaceActivityEvent, 0, len(m.workspaceHub.subscribers))
	for _, sub := range m.workspaceHub.subscribers {
		if sub.workdir == workdir {
			targets = append(targets, sub.ch)
		}
	}
	m.workspaceHub.mu.Unlock()

	for _, ch := range targets {
		select {
		case ch <- event:
		default:
		}
	}
}

func (m *Manager) hasWorkspaceWatchInterest() bool {
	m.workspaceHub.mu.Lock()
	defer m.workspaceHub.mu.Unlock()
	return len(m.workspaceHub.watchCounts) > 0
}

// pushWorkspaceWatchSet sends the full watched-workdir set to the agent.
// Best-effort and non-blocking: the set is re-pushed on every change and on
// agent reconnect, so a dropped push heals itself.
func (m *Manager) pushWorkspaceWatchSet() {
	m.workspaceHub.mu.Lock()
	workdirs := make([]string, 0, len(m.workspaceHub.watchCounts))
	for workdir := range m.workspaceHub.watchCounts {
		workdirs = append(workdirs, workdir)
	}
	m.workspaceHub.mu.Unlock()
	sort.Strings(workdirs)

	m.registry.mu.RLock()
	session := m.registry.session
	m.registry.mu.RUnlock()
	if session == nil {
		return
	}
	_, _ = session.TrySendToAgent(&gatewayv1.GatewayEnvelope{
		RequestId: "workspace-watch-" + uuid.NewString(),
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_WorkspaceWatch{
			WorkspaceWatch: &gatewayv1.WorkspaceWatchRequest{Workdirs: workdirs},
		},
	})
}
