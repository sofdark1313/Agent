package session

import (
	"sort"
	"strings"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

type chatQueueSnapshotRecord struct {
	event        *gatewayv1.ChatQueueEvent
	sessionEpoch uint64
}

func (m *Manager) SubscribeChatQueueEvents() (<-chan *gatewayv1.ChatQueueEvent, func()) {
	m.syncHub.chatQueueMu.Lock()
	replay := make([]*gatewayv1.ChatQueueEvent, 0, len(m.syncHub.chatQueueSnapshots))
	conversationIDs := make([]string, 0, len(m.syncHub.chatQueueSnapshots))
	for conversationID := range m.syncHub.chatQueueSnapshots {
		conversationIDs = append(conversationIDs, conversationID)
	}
	sort.Strings(conversationIDs)
	for _, conversationID := range conversationIDs {
		replay = append(replay, cloneChatQueueEvent(m.syncHub.chatQueueSnapshots[conversationID].event))
	}
	ch := make(chan *gatewayv1.ChatQueueEvent, 128+len(replay))
	subID := m.syncHub.nextChatQueueSubID
	m.syncHub.nextChatQueueSubID += 1
	m.syncHub.chatQueueSubscribers[subID] = ch
	m.syncHub.chatQueueMu.Unlock()

	for _, event := range replay {
		ch <- event
	}

	cleanup := func() {
		m.syncHub.chatQueueMu.Lock()
		if _, ok := m.syncHub.chatQueueSubscribers[subID]; ok {
			delete(m.syncHub.chatQueueSubscribers, subID)
		}
		m.syncHub.chatQueueMu.Unlock()
	}

	return ch, cleanup
}

func (m *Manager) ChatQueueSnapshot(conversationID string) (*gatewayv1.ChatQueueEvent, bool) {
	key := strings.TrimSpace(conversationID)
	if key == "" {
		return nil, false
	}

	m.syncHub.chatQueueMu.Lock()
	defer m.syncHub.chatQueueMu.Unlock()

	record, ok := m.syncHub.chatQueueSnapshots[key]
	if !ok {
		return nil, false
	}
	return cloneChatQueueEvent(record.event), true
}

func (m *Manager) broadcastChatQueueEvent(event *gatewayv1.ChatQueueEvent) {
	if event == nil {
		return
	}
	normalized := cloneChatQueueEvent(event)
	conversationID := strings.TrimSpace(normalized.GetConversationId())
	if conversationID != "" {
		normalized.ConversationId = conversationID
	}
	sessionEpoch := m.currentSessionEpoch()

	m.syncHub.chatQueueMu.Lock()
	if conversationID != "" {
		if existing := m.syncHub.chatQueueSnapshots[conversationID]; existing.event != nil && existing.sessionEpoch == sessionEpoch {
			existingRevision := existing.event.GetRevision()
			incomingRevision := normalized.GetRevision()
			if existingRevision > 0 && (incomingRevision == 0 || incomingRevision < existingRevision) {
				m.syncHub.chatQueueMu.Unlock()
				return
			}
		}
		m.syncHub.chatQueueSnapshots[conversationID] = chatQueueSnapshotRecord{
			event:        cloneChatQueueEvent(normalized),
			sessionEpoch: sessionEpoch,
		}
	}
	subscribers := make([]chan *gatewayv1.ChatQueueEvent, 0, len(m.syncHub.chatQueueSubscribers))
	for _, ch := range m.syncHub.chatQueueSubscribers {
		subscribers = append(subscribers, ch)
	}
	m.syncHub.chatQueueMu.Unlock()

	for _, ch := range subscribers {
		select {
		case ch <- cloneChatQueueEvent(normalized):
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func cloneChatQueueEvent(event *gatewayv1.ChatQueueEvent) *gatewayv1.ChatQueueEvent {
	if event == nil {
		return nil
	}
	return &gatewayv1.ChatQueueEvent{
		ConversationId: event.GetConversationId(),
		SnapshotJson:   event.GetSnapshotJson(),
		Revision:       event.GetRevision(),
	}
}
