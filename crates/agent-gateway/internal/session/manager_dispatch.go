package session

import (
	"strings"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (m *Manager) DispatchFromAgent(env *gatewayv1.AgentEnvelope) {
	m.dispatchFromAgent(nil, env)
}

func (m *Manager) DispatchFromAgentForSession(session *AgentSession, env *gatewayv1.AgentEnvelope) {
	m.dispatchFromAgent(session, env)
}

func (m *Manager) dispatchFromAgent(expected *AgentSession, env *gatewayv1.AgentEnvelope) {
	m.registry.mu.RLock()
	session := m.registry.session
	m.registry.mu.RUnlock()
	if session == nil || (expected != nil && session != expected) {
		return
	}

	if runtimeStatus := env.GetRuntimeStatus(); runtimeStatus != nil {
		m.UpdateRuntimeStatus(session, runtimeStatus)
		m.convStreams.onRuntimeStatus(runtimeStatus, time.Now())
		return
	}

	if env.GetChatEvent() != nil || env.GetChatControl() != nil || env.GetChatRuntimeSnapshot() != nil {
		m.touchRuntimeActivity(session)
	}

	if runtimeSnapshot := env.GetChatRuntimeSnapshot(); runtimeSnapshot != nil {
		m.ingestRuntimeSnapshot(runtimeSnapshot)
		return
	}

	if chatEvent := env.GetChatEvent(); chatEvent != nil {
		m.ingestChatEvent(env.GetRequestId(), chatEvent)
	}

	if chatControl := env.GetChatControl(); chatControl != nil {
		m.ingestChatControl(env.GetRequestId(), chatControl)
	}

	if historySync := env.GetHistorySync(); historySync != nil {
		// Agent-sent running/idle activity is dropped: conversation activity
		// is derived from run lifecycle transitions in the stream store, which
		// always carry run ids.
		switch strings.TrimSpace(historySync.GetKind()) {
		case "running", "idle":
			return
		}
		m.broadcastHistorySync(historySync)
		return
	}

	if settingsSync := env.GetSettingsSync(); settingsSync != nil {
		m.broadcastSettingsSync(settingsSync)
		return
	}

	if terminalEvent := env.GetTerminalEvent(); terminalEvent != nil {
		m.broadcastTerminalEvent(terminalEvent)
		return
	}

	if sftpEvent := env.GetSftpEvent(); sftpEvent != nil {
		m.broadcastSftpEvent(sftpEvent)
		return
	}

	if chatQueueEvent := env.GetChatQueueEvent(); chatQueueEvent != nil {
		m.broadcastChatQueueEvent(chatQueueEvent)
		return
	}

	if tunnelFrame := env.GetTunnelFrame(); tunnelFrame != nil {
		m.dispatchTunnelFrame(tunnelFrame)
		return
	}

	if workspaceActivity := env.GetWorkspaceActivity(); workspaceActivity != nil {
		m.broadcastWorkspaceActivity(workspaceActivity)
		return
	}

	if managedProcessSnapshot := env.GetManagedProcessSnapshot(); managedProcessSnapshot != nil {
		m.broadcastManagedProcessSnapshot(managedProcessSnapshot)
		return
	}

	// Desired-state and probe payloads fan out broadcasts and relay probes;
	// run them off the gRPC read loop so tunnel frames keep flowing.
	if tunnelDesired := env.GetTunnelDesired(); tunnelDesired != nil {
		go m.ApplyDesiredState(tunnelDesired)
		return
	}

	if tunnelProbeReport := env.GetTunnelProbeReport(); tunnelProbeReport != nil {
		go m.ApplyProbeReport(tunnelProbeReport)
		return
	}

	// TunnelMutationResult and ManagedProcessResponse intentionally fall
	// through to session.dispatch: they answer gateway-issued requests and
	// correlate by request id.
	session.dispatch(env)
}
