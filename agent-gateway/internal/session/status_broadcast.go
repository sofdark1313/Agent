package session

import "sync"

// statusSubscriberHub fans out agent Status snapshots to /ws connections so
// clients learn about agent connect/disconnect by push instead of polling.
type statusSubscriberHub struct {
	mu          sync.Mutex
	nextSubID   uint64
	subscribers map[uint64]chan Status
}

func newStatusSubscriberHub() *statusSubscriberHub {
	return &statusSubscriberHub{
		subscribers: make(map[uint64]chan Status),
	}
}

func (m *Manager) SubscribeStatus() (<-chan Status, func()) {
	ch := make(chan Status, 8)

	m.statusSubs.mu.Lock()
	subID := m.statusSubs.nextSubID
	m.statusSubs.nextSubID += 1
	m.statusSubs.subscribers[subID] = ch
	m.statusSubs.mu.Unlock()

	cleanup := func() {
		m.statusSubs.mu.Lock()
		// Do not close the channel: broadcastStatus sends after copying
		// subscribers, so closing can race with an in-flight send.
		delete(m.statusSubs.subscribers, subID)
		m.statusSubs.mu.Unlock()
	}
	return ch, cleanup
}

// broadcastStatus pushes the current status snapshot to /ws subscribers.
// Sends are non-blocking: a stalled subscriber misses intermediate snapshots
// and reconciles from its fallback status poll.
func (m *Manager) broadcastStatus() {
	snapshot := m.Status()

	m.statusSubs.mu.Lock()
	subscribers := make([]chan Status, 0, len(m.statusSubs.subscribers))
	for _, ch := range m.statusSubs.subscribers {
		subscribers = append(subscribers, ch)
	}
	m.statusSubs.mu.Unlock()

	for _, ch := range subscribers {
		select {
		case ch <- snapshot:
		default:
		}
	}
}
