package session

import (
	"context"
	"errors"
	"strings"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (m *Manager) RecordAuthentication(agentID, agentVersion, sessionID string) {
	m.registry.mu.Lock()
	defer m.registry.mu.Unlock()
	m.registry.lastAuth = AuthSnapshot{
		AgentID:      agentID,
		AgentVersion: agentVersion,
		SessionID:    sessionID,
	}
	m.registry.authValid = true
}

func (m *Manager) LatestAuthSnapshot() AuthSnapshot {
	m.registry.mu.RLock()
	defer m.registry.mu.RUnlock()
	return m.registry.lastAuth
}

func (m *Manager) IsOnline() bool {
	m.registry.mu.RLock()
	defer m.registry.mu.RUnlock()
	return m.registry.session != nil
}

func (m *Manager) SetSession(s *AgentSession) {
	m.registry.mu.Lock()
	previous := m.registry.session
	if m.registry.authValid {
		s.AgentID = m.registry.lastAuth.AgentID
		s.AgentVersion = m.registry.lastAuth.AgentVersion
		s.SessionID = m.registry.lastAuth.SessionID
	}
	if previous != s {
		m.registry.sessionEpoch += 1
		clearRuntimeStatusLocked(m.registry)
	}
	sessionChanged := previous != s
	m.registry.session = s
	m.registry.mu.Unlock()

	if sessionChanged {
		m.clearTerminalSessionSnapshot()
	}
	if previous != nil && previous != s {
		previous.Close()
	}
	if s != nil && sessionChanged {
		m.cmdQueue.DrainTo(s)
		// Replay the watched-workdir set: a freshly connected agent starts
		// with an empty watch set and only learns a non-empty one from this
		// push. An empty set needs no replay.
		if m.hasWorkspaceWatchInterest() {
			go m.pushWorkspaceWatchSet()
		}
	}
	if sessionChanged {
		m.broadcastStatus()
	}
}

func (m *Manager) ClearSession(session *AgentSession) {
	m.registry.mu.Lock()
	if m.registry.session != session {
		m.registry.mu.Unlock()
		return
	}
	m.registry.session = nil
	clearRuntimeStatusLocked(m.registry)
	m.registry.mu.Unlock()

	if session == nil {
		return
	}

	session.Close()
	m.clearTerminalSessionSnapshot()
	go m.onAgentSessionCleared()
}

func (m *Manager) ClearSessionIfHeartbeatStale(session *AgentSession, timeout time.Duration) bool {
	if session == nil || timeout <= 0 {
		return false
	}

	now := time.Now()
	m.registry.mu.Lock()
	if m.registry.session != session {
		m.registry.mu.Unlock()
		return false
	}
	if lastPing := m.registry.session.LastPing; !lastPing.IsZero() && now.Sub(lastPing) <= timeout {
		m.registry.mu.Unlock()
		return false
	}
	m.registry.session = nil
	clearRuntimeStatusLocked(m.registry)
	m.registry.mu.Unlock()

	session.Close()
	m.clearTerminalSessionSnapshot()
	go m.onAgentSessionCleared()
	return true
}

func (m *Manager) clearSessionForEpoch(sessionEpoch uint64) bool {
	m.registry.mu.Lock()
	session := m.registry.session
	if session == nil || m.registry.sessionEpoch != sessionEpoch {
		m.registry.mu.Unlock()
		return false
	}
	m.registry.session = nil
	clearRuntimeStatusLocked(m.registry)
	m.registry.mu.Unlock()

	session.Close()
	m.clearTerminalSessionSnapshot()
	go m.onAgentSessionCleared()
	return true
}

func (m *Manager) Status() Status {
	m.registry.mu.RLock()
	defer m.registry.mu.RUnlock()

	now := time.Now()
	status := Status{}
	if m.registry.authValid {
		status.AgentID = m.registry.lastAuth.AgentID
		status.AgentVersion = m.registry.lastAuth.AgentVersion
		status.SessionID = m.registry.lastAuth.SessionID
	}
	if m.registry.session == nil {
		return status
	}
	status.Online = true
	status.AgentReady = true
	status.AgentID = m.registry.session.AgentID
	status.AgentVersion = m.registry.session.AgentVersion
	status.SessionID = m.registry.session.SessionID
	status.ConnectedSince = m.registry.session.ConnectedAt.Unix()
	status.LastHeartbeat = m.registry.session.LastPing.Unix()
	status.RuntimeState = m.registry.runtimeState
	status.RuntimeWorkerID = m.registry.runtimeWorkerID
	status.RuntimeVisible = m.registry.runtimeVisible
	status.RuntimeActiveRunCount = m.registry.runtimeActiveRunCount
	if !m.registry.runtimeLastHeartbeat.IsZero() {
		status.RuntimeLastHeartbeat = m.registry.runtimeLastHeartbeat.Unix()
	}
	status.ChatRuntimeReady = runtimeReadyLocked(m.registry, now)
	return status
}

func (m *Manager) ChatRuntimeReady() bool {
	m.registry.mu.RLock()
	defer m.registry.mu.RUnlock()
	return runtimeReadyLocked(m.registry, time.Now())
}

func (m *Manager) ChatRuntimeProbeEpoch() (uint64, bool) {
	m.registry.mu.RLock()
	defer m.registry.mu.RUnlock()
	if m.registry.session == nil {
		return 0, false
	}
	return m.registry.sessionEpoch, true
}

func (m *Manager) RecordChatRuntimeProbe(sessionEpoch uint64) bool {
	m.registry.mu.Lock()
	defer m.registry.mu.Unlock()
	if sessionEpoch == 0 || m.registry.session == nil || m.registry.sessionEpoch != sessionEpoch {
		return false
	}
	m.registry.chatRuntimeProbeAt = time.Now()
	return true
}

func (m *Manager) ChatRuntimeProbeFresh(maxAge time.Duration) bool {
	if maxAge <= 0 {
		return false
	}
	m.registry.mu.RLock()
	defer m.registry.mu.RUnlock()
	return m.registry.session != nil &&
		!m.registry.chatRuntimeProbeAt.IsZero() &&
		time.Since(m.registry.chatRuntimeProbeAt) <= maxAge
}

func (m *Manager) UpdateRuntimeStatus(
	session *AgentSession,
	event *gatewayv1.RuntimeStatusEvent,
) {
	if event == nil {
		return
	}
	workerID := strings.TrimSpace(event.GetWorkerId())
	state := normalizeRuntimeState(event.GetState())
	now := time.Now()

	m.registry.mu.Lock()
	if m.registry.session == nil || (session != nil && m.registry.session != session) {
		m.registry.mu.Unlock()
		return
	}
	previousReady := runtimeReadyLocked(m.registry, now)
	changed := m.registry.runtimeState != state ||
		m.registry.runtimeWorkerID != workerID ||
		m.registry.runtimeVisible != event.GetVisible() ||
		m.registry.runtimeActiveRunCount != event.GetActiveRunCount()
	m.registry.runtimeState = state
	m.registry.runtimeWorkerID = workerID
	m.registry.runtimeLastHeartbeat = now
	m.registry.runtimeVisible = event.GetVisible()
	m.registry.runtimeActiveRunCount = event.GetActiveRunCount()
	changed = changed || previousReady != runtimeReadyLocked(m.registry, now)
	m.registry.mu.Unlock()

	// Runtime readiness is part of the public Status contract. Push semantic
	// transitions, but do not fan out a status frame for every heartbeat tick;
	// the low-frequency status poll reconciles timestamp-only changes.
	if changed {
		m.broadcastStatus()
	}
}

// touchRuntimeActivity refreshes the chat-runtime heartbeat when live chat
// traffic proves the desktop runtime is running, even while the webview's
// own status timer is throttled (hidden/occluded window). Only refreshes an
// already-reporting runtime: a zero heartbeat must not become readiness
// (normalizeRuntimeState("") defaults to "ready").
func (m *Manager) touchRuntimeActivity(session *AgentSession) {
	m.registry.mu.Lock()
	defer m.registry.mu.Unlock()
	if m.registry.session != session || m.registry.runtimeLastHeartbeat.IsZero() {
		return
	}
	m.registry.runtimeLastHeartbeat = time.Now()
}

func (m *Manager) TouchHeartbeat(session *AgentSession) {
	m.registry.mu.Lock()
	defer m.registry.mu.Unlock()
	if m.registry.session == session {
		m.registry.session.LastPing = time.Now()
	}
}

func clearRuntimeStatusLocked(registry *sessionRegistry) {
	registry.runtimeState = ""
	registry.runtimeWorkerID = ""
	registry.runtimeLastHeartbeat = time.Time{}
	registry.runtimeVisible = false
	registry.runtimeActiveRunCount = 0
	registry.chatRuntimeProbeAt = time.Time{}
}

func runtimeReadyLocked(registry *sessionRegistry, now time.Time) bool {
	if registry == nil || registry.session == nil {
		return false
	}
	if registry.session.LastPing.IsZero() || now.Sub(registry.session.LastPing) > agentSessionHeartbeatTTL {
		return false
	}
	if registry.runtimeLastHeartbeat.IsZero() ||
		now.Sub(registry.runtimeLastHeartbeat) > chatRuntimeReadyTTL {
		return false
	}
	switch normalizeRuntimeState(registry.runtimeState) {
	case "ready", "draining", "busy":
		return true
	default:
		return false
	}
}

func normalizeRuntimeState(state string) string {
	switch strings.TrimSpace(state) {
	case "ready", "draining", "busy", "suspended":
		return strings.TrimSpace(state)
	default:
		return defaultRuntimeReadyState
	}
}

func (m *Manager) SendToAgent(env *gatewayv1.GatewayEnvelope) error {
	m.registry.mu.RLock()
	session := m.registry.session
	m.registry.mu.RUnlock()
	if session == nil {
		return ErrAgentOffline
	}
	return session.SendToAgent(env)
}

func (m *Manager) SendToAgentContext(ctx context.Context, env *gatewayv1.GatewayEnvelope) error {
	m.registry.mu.RLock()
	session := m.registry.session
	m.registry.mu.RUnlock()
	if session == nil {
		return ErrAgentOffline
	}
	return session.SendToAgentContext(ctx, env)
}

func (m *Manager) SendToAgentOrQueue(ctx context.Context, env *gatewayv1.GatewayEnvelope) error {
	err := m.SendToAgentContext(ctx, env)
	if errors.Is(err, ErrAgentOffline) {
		return m.cmdQueue.Enqueue(ctx, env)
	}
	return err
}

func (m *Manager) currentSessionEpoch() uint64 {
	m.registry.mu.RLock()
	defer m.registry.mu.RUnlock()
	return m.registry.sessionEpoch
}

func (m *Manager) RegisterStream(requestID string) (<-chan *gatewayv1.AgentEnvelope, <-chan struct{}, func(), error) {
	m.registry.mu.RLock()
	session := m.registry.session
	m.registry.mu.RUnlock()
	if session == nil {
		return nil, nil, nil, ErrAgentOffline
	}

	stream, err := session.registerStream(requestID)
	if err != nil {
		return nil, nil, nil, err
	}

	cleanup := func() {
		session.unregisterStream(requestID, stream)
	}

	return stream.ch, stream.done, cleanup, nil
}

// RegisterStreamAndSendContext binds response correlation and request delivery
// to the same AgentSession instance. Calling RegisterStream followed by
// Manager.SendToAgentContext performs two independent current-session lookups;
// a seamless session replacement between them can register the stream on the
// old session while sending the request to the new one, making every response
// unmatchable. Capturing the session once closes that TOCTOU window.
func (m *Manager) RegisterStreamAndSendContext(
	ctx context.Context,
	requestID string,
	env *gatewayv1.GatewayEnvelope,
) (<-chan *gatewayv1.AgentEnvelope, <-chan struct{}, func(), error) {
	m.registry.mu.RLock()
	session := m.registry.session
	m.registry.mu.RUnlock()
	if session == nil {
		return nil, nil, nil, ErrAgentOffline
	}

	stream, err := session.registerStream(requestID)
	if err != nil {
		return nil, nil, nil, err
	}
	cleanup := func() {
		session.unregisterStream(requestID, stream)
	}
	if err := session.SendToAgentContext(ctx, env); err != nil {
		cleanup()
		return nil, nil, nil, err
	}

	return stream.ch, stream.done, cleanup, nil
}
