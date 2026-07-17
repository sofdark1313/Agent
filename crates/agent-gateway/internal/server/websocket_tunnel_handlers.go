package server

import (
	"errors"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

type websocketTunnelMutationPayload struct {
	TunnelID       string  `json:"tunnel_id"`
	TargetURL      string  `json:"target_url"`
	Name           string  `json:"name"`
	TTLSeconds     *uint32 `json:"ttl_seconds"`
	ProjectPathKey string  `json:"project_path_key"`
}

func (c *websocketConnection) handleTunnelCreate(req websocketRequest) {
	c.handleTunnelMutation(req, "create")
}

func (c *websocketConnection) handleTunnelUpdate(req websocketRequest) {
	c.handleTunnelMutation(req, "update")
}

func (c *websocketConnection) handleTunnelClose(req websocketRequest) {
	c.handleTunnelMutation(req, "close")
}

func (c *websocketConnection) handleTunnelCheck(req websocketRequest) {
	c.handleTunnelMutation(req, "check")
}

// handleTunnelMutation forwards a webui tunnel mutation to the agent (the
// desired-state owner) and relays its verdict. State itself arrives on every
// client through the tunnel.state broadcast that the mutation triggers.
func (c *websocketConnection) handleTunnelMutation(req websocketRequest, action string) {
	if !c.sm.WebTunnelsEnabled() {
		_ = c.writeError(req.ID, "web tunnels are disabled in desktop Remote settings")
		return
	}

	var body websocketTunnelMutationPayload
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid tunnel."+action+" payload")
		return
	}

	mutation := &gatewayv1.TunnelMutation{
		Action:         action,
		TunnelId:       body.TunnelID,
		TargetUrl:      body.TargetURL,
		Name:           body.Name,
		TtlSeconds:     body.TTLSeconds,
		ProjectPathKey: body.ProjectPathKey,
	}

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_TunnelMutation{
			TunnelMutation: mutation,
		},
	})
	if err != nil {
		_ = c.writeError(req.ID, websocketErrorMessage(err))
		return
	}
	if errResp := response.GetError(); errResp != nil {
		_ = c.writeError(req.ID, errResp.GetMessage())
		return
	}
	result := response.GetTunnelMutationResult()
	if result == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}
	if result.GetErrorMessage() != "" {
		_ = c.writeError(req.ID, result.GetErrorMessage())
		return
	}
	_ = c.writeResponse(req.ID, map[string]any{
		"tunnel_id": result.GetTunnelId(),
	})
}

func (c *websocketConnection) startTunnelStateForwarder() {
	if c.tunnelStateEvents != nil || c.tunnelStateEventsCleanup != nil {
		return
	}

	tunnelStateEvents, cleanup := c.sm.SubscribeTunnelState()
	c.tunnelStateEvents = tunnelStateEvents
	c.tunnelStateEventsCleanup = cleanup

	go func() {
		for {
			select {
			case <-c.done:
				return
			case snapshot, ok := <-tunnelStateEvents:
				if !ok {
					return
				}
				if err := c.writeEvent("tunnel.state", websocketTunnelStatePayload(snapshot)); err != nil {
					if errors.Is(err, errWriteQueueFull) {
						continue
					}
					return
				}
			}
		}
	}()
}

func (c *websocketConnection) replayTunnelStateSnapshot() {
	_ = c.writeEvent("tunnel.state", websocketTunnelStatePayload(c.sm.TunnelStateSnapshot()))
}

func websocketTunnelStatePayload(snapshot *gatewayv1.TunnelStateSnapshot) map[string]any {
	if snapshot == nil {
		return map[string]any{
			"revision":     0,
			"agent_online": false,
			"tunnels":      []map[string]any{},
		}
	}
	tunnels := make([]map[string]any, 0, len(snapshot.GetTunnels()))
	for _, tunnel := range snapshot.GetTunnels() {
		if tunnel == nil {
			continue
		}
		tunnels = append(tunnels, map[string]any{
			"id":                 tunnel.GetId(),
			"slug":               tunnel.GetSlug(),
			"name":               tunnel.GetName(),
			"target_url":         tunnel.GetTargetUrl(),
			"public_path":        tunnel.GetPublicPath(),
			"created_at":         tunnel.GetCreatedAt(),
			"expires_at":         tunnel.GetExpiresAt(),
			"active_connections": tunnel.GetActiveConnections(),
			"project_path_key":   tunnel.GetProjectPathKey(),
			"local":              websocketTunnelHealthPayload(tunnel.GetLocal()),
		})
	}
	return map[string]any{
		"revision":     snapshot.GetRevision(),
		"agent_online": snapshot.GetAgentOnline(),
		"relay":        websocketTunnelHealthPayload(snapshot.GetRelay()),
		"tunnels":      tunnels,
	}
}

func websocketTunnelHealthPayload(health *gatewayv1.TunnelHealth) map[string]any {
	if health == nil {
		return nil
	}
	return map[string]any{
		"status":      health.GetStatus(),
		"http_status": health.GetHttpStatus(),
		"error":       health.GetError(),
		"checked_at":  health.GetCheckedAt(),
		"rtt_ms":      health.GetRttMs(),
	}
}
