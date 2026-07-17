package session

import (
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (m *Manager) SubscribeHistorySync() (<-chan *gatewayv1.HistorySyncEvent, func()) {
	ch := make(chan *gatewayv1.HistorySyncEvent, 128)

	m.syncHub.historyMu.Lock()
	subID := m.syncHub.nextHistorySubID
	m.syncHub.nextHistorySubID += 1
	m.syncHub.historySubscribers[subID] = ch
	m.syncHub.historyMu.Unlock()

	cleanup := func() {
		m.syncHub.historyMu.Lock()
		if _, ok := m.syncHub.historySubscribers[subID]; ok {
			// Do not close the channel here: broadcastHistorySync sends after
			// copying subscribers, so closing can race with an in-flight send.
			delete(m.syncHub.historySubscribers, subID)
		}
		m.syncHub.historyMu.Unlock()
	}

	return ch, cleanup
}

func (m *Manager) broadcastHistorySync(event *gatewayv1.HistorySyncEvent) {
	if event == nil {
		return
	}

	m.syncHub.historyMu.Lock()
	subscribers := make([]chan *gatewayv1.HistorySyncEvent, 0, len(m.syncHub.historySubscribers))
	for _, ch := range m.syncHub.historySubscribers {
		subscribers = append(subscribers, ch)
	}
	m.syncHub.historyMu.Unlock()

	for _, ch := range subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}
