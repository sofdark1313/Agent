package server

import (
	"encoding/json"
	"strings"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (c *websocketConnection) handleSettingsGet(req websocketRequest) {
	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_SettingsGet{
			SettingsGet: &gatewayv1.SettingsGetRequest{},
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

	settingsResp := response.GetSettingsGetResp()
	if settingsResp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	payload, err := websocketSettingsJSONPayload(settingsResp.GetSettingsJson())
	if err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}
	c.sm.ApplySettingsJSON(settingsResp.GetSettingsJson())

	_ = c.writeResponse(req.ID, payload)
}

func (c *websocketConnection) handleSettingsUpdate(req websocketRequest) {
	payloadJSON, err := websocketRawPayloadJSON(req.Payload)
	if err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_SettingsUpdate{
			SettingsUpdate: &gatewayv1.SettingsUpdateRequest{
				SettingsJson: payloadJSON,
			},
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

	settingsResp := response.GetSettingsUpdateResp()
	if settingsResp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}
	if settingsResp.GetAccepted() {
		var patch map[string]any
		hasSshPatch := json.Unmarshal([]byte(payloadJSON), &patch) == nil && patch != nil
		if hasSshPatch {
			_, hasSshPatch = patch["sshPatch"]
		}
		if !hasSshPatch {
			c.sm.ApplySettingsJSONPreservingRemote(payloadJSON)
		}
	}

	_ = c.writeResponse(req.ID, map[string]any{
		"accepted": settingsResp.GetAccepted(),
		"message":  strings.TrimSpace(settingsResp.GetMessage()),
	})
}

func (c *websocketConnection) handleSettingsResetSshKnownHost(req websocketRequest) {
	if !c.sm.WebSshTerminalEnabled() {
		_ = c.writeError(req.ID, "web SSH terminal is disabled in desktop Remote settings")
		return
	}

	var body websocketSshKnownHostResetPayload
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid settings.ssh_known_host.reset payload")
		return
	}

	host := strings.TrimSpace(body.Host)
	if host == "" {
		_ = c.writeError(req.ID, "SSH host is required")
		return
	}
	if body.Port == nil || *body.Port <= 0 {
		_ = c.writeError(req.ID, "SSH port is required")
		return
	}
	if *body.Port > 65535 {
		_ = c.writeError(req.ID, "SSH port must be <= 65535")
		return
	}
	port := uint32(*body.Port)

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_SettingsResetSshKnownHost{
			SettingsResetSshKnownHost: &gatewayv1.SettingsResetSshKnownHostRequest{
				Host: host,
				Port: port,
			},
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

	settingsResp := response.GetSettingsResetSshKnownHostResp()
	if settingsResp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	_ = c.writeResponse(req.ID, map[string]any{
		"deleted": settingsResp.GetDeleted(),
	})
}
