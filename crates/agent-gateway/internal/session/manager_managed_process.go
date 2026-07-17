package session

import (
	"sync"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

// managedProcessHub caches the latest ManagedProcess snapshot published by
// the agent and fans it out to websocket subscribers. Delivery is
// latest-wins and non-blocking: a congested subscriber just skips ahead to
// the next snapshot.
type managedProcessHub struct {
	mu          sync.Mutex
	latest      *gatewayv1.ManagedProcessSnapshot
	subscribers map[uint64]chan *gatewayv1.ManagedProcessSnapshot
	nextSubID   uint64
}

func newManagedProcessHub() *managedProcessHub {
	return &managedProcessHub{
		subscribers: make(map[uint64]chan *gatewayv1.ManagedProcessSnapshot),
	}
}

// ManagedProcessSnapshotCached returns the last snapshot seen from the agent
// (nil before the first publish), so webui clients can render the latest
// known state even while the agent is offline.
func (m *Manager) ManagedProcessSnapshotCached() *gatewayv1.ManagedProcessSnapshot {
	m.managedProcesses.mu.Lock()
	defer m.managedProcesses.mu.Unlock()
	return m.managedProcesses.latest
}

func (m *Manager) SubscribeManagedProcessState() (<-chan *gatewayv1.ManagedProcessSnapshot, func()) {
	hub := m.managedProcesses
	ch := make(chan *gatewayv1.ManagedProcessSnapshot, 16)

	hub.mu.Lock()
	subID := hub.nextSubID
	hub.nextSubID += 1
	hub.subscribers[subID] = ch
	hub.mu.Unlock()

	cleanup := func() {
		hub.mu.Lock()
		// Do not close the channel: the broadcast sends after copying the
		// subscriber list, so closing can race with an in-flight send.
		delete(hub.subscribers, subID)
		hub.mu.Unlock()
	}
	return ch, cleanup
}

func (m *Manager) broadcastManagedProcessSnapshot(snapshot *gatewayv1.ManagedProcessSnapshot) {
	if snapshot == nil {
		return
	}
	hub := m.managedProcesses
	hub.mu.Lock()
	// Agent-side publishes are spawned per change and can arrive reordered;
	// revisions are agent-stamped and restart-safe, so drop strictly older
	// snapshots (equal ones still flow for agent-online re-stamps).
	if hub.latest != nil && snapshot.GetRevision() < hub.latest.GetRevision() {
		hub.mu.Unlock()
		return
	}
	hub.latest = snapshot
	subscribers := make([]chan *gatewayv1.ManagedProcessSnapshot, 0, len(hub.subscribers))
	for _, ch := range hub.subscribers {
		subscribers = append(subscribers, ch)
	}
	hub.mu.Unlock()

	for _, ch := range subscribers {
		select {
		case ch <- snapshot:
		default:
		}
	}
}

// rebroadcastManagedProcessState replays the cached snapshot so subscribers
// re-render with the current agent-online flag (stamped at write time).
func (m *Manager) rebroadcastManagedProcessState() {
	m.managedProcesses.mu.Lock()
	latest := m.managedProcesses.latest
	m.managedProcesses.mu.Unlock()
	if latest == nil {
		return
	}
	m.broadcastManagedProcessSnapshot(latest)
}
