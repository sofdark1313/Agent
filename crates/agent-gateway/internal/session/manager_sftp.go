package session

import (
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (m *Manager) SubscribeSftpEvents() (<-chan *gatewayv1.SftpEvent, func()) {
	ch := make(chan *gatewayv1.SftpEvent, 4096)

	m.syncHub.sftpMu.Lock()
	subID := m.syncHub.nextSftpSubID
	m.syncHub.nextSftpSubID += 1
	m.syncHub.sftpSubscribers[subID] = ch
	m.syncHub.sftpMu.Unlock()

	cleanup := func() {
		m.syncHub.sftpMu.Lock()
		if _, ok := m.syncHub.sftpSubscribers[subID]; ok {
			// Do not close the channel here: broadcastSftpEvent sends after
			// copying subscribers, so closing can race with an in-flight send.
			delete(m.syncHub.sftpSubscribers, subID)
		}
		m.syncHub.sftpMu.Unlock()
	}

	return ch, cleanup
}

func (m *Manager) broadcastSftpEvent(event *gatewayv1.SftpEvent) {
	if event == nil {
		return
	}

	m.syncHub.sftpMu.Lock()
	subscribers := make([]chan *gatewayv1.SftpEvent, 0, len(m.syncHub.sftpSubscribers))
	for _, ch := range m.syncHub.sftpSubscribers {
		subscribers = append(subscribers, ch)
	}
	m.syncHub.sftpMu.Unlock()

	for _, ch := range subscribers {
		select {
		case ch <- event:
		case <-time.After(50 * time.Millisecond):
		}
	}
}
