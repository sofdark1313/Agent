package session

import "sync"

// chatActivityHub fans conversation activity transitions (running/idle with
// run ids) out to every authenticated webui connection. Events are composed
// inside the stream store's locked transitions, so per-conversation ordering
// is the log order. Activity is state-based: when a slow subscriber's buffer
// fills, the oldest pending event is dropped so the latest state still lands.
type chatActivityHub struct {
	mu          sync.Mutex
	nextSubID   int
	subscribers map[int]chan ConversationActivityEvent
}

func newChatActivityHub() *chatActivityHub {
	return &chatActivityHub{
		subscribers: make(map[int]chan ConversationActivityEvent),
	}
}

// SubscribeChatActivity registers an activity listener. The current activity
// of every active conversation is replayed first so a fresh connection needs
// no separate hydration round-trip.
func (m *Manager) SubscribeChatActivity() (<-chan ConversationActivityEvent, func()) {
	hub := m.convStreams.activityHub

	// Replay current activities before registering so a concurrent transition
	// is delivered after its predecessor state, never before. The channel is
	// sized to hold the whole replay: nothing reads it until this returns, so
	// a blocking send here would wedge both mutexes.
	m.convStreams.mu.Lock()
	replay := make([]ConversationActivityEvent, 0, len(m.convStreams.streams))
	for _, stream := range m.convStreams.streams {
		if stream.activity == nil {
			continue
		}
		event := ConversationActivityEvent{
			ConversationID:  stream.conversationID,
			RunID:           stream.activity.RunID,
			ClientRequestID: stream.activity.ClientRequestID,
			Running:         true,
			State:           stream.activity.State,
			Workdir:         stream.activity.Workdir,
			UpdatedAt:       stream.activity.UpdatedAt,
		}
		if event.Workdir == "" {
			event.Workdir = stream.workdir
		}
		replay = append(replay, event)
	}
	ch := make(chan ConversationActivityEvent, len(replay)+64)
	hub.mu.Lock()
	subID := hub.nextSubID
	hub.nextSubID++
	hub.subscribers[subID] = ch
	for _, event := range replay {
		ch <- event
	}
	hub.mu.Unlock()
	m.convStreams.mu.Unlock()

	cleanup := func() {
		hub.mu.Lock()
		// The channel is never closed: publish may hold a reference collected
		// before cleanup ran. Subscribers exit via their own done signal.
		delete(hub.subscribers, subID)
		hub.mu.Unlock()
	}
	return ch, cleanup
}

// publish is called while the stream store mutex is held (store.mu → hub.mu
// is the only lock order). Sends never block: on a full buffer the oldest
// pending event is discarded — activity is a state signal, latest wins.
func (hub *chatActivityHub) publish(event ConversationActivityEvent) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	for _, ch := range hub.subscribers {
		select {
		case ch <- event:
			continue
		default:
		}
		select {
		case <-ch:
		default:
		}
		select {
		case ch <- event:
		default:
		}
	}
}
