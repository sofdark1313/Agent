package server

import (
	"encoding/json"
	"strings"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (c *websocketConnection) handleMemoryManage(req websocketRequest) {
	type payload struct {
		Command string          `json:"command"`
		Args    json.RawMessage `json:"args"`
	}

	var body payload
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid memory.manage payload")
		return
	}

	command := strings.TrimSpace(body.Command)
	if command == "" {
		_ = c.writeError(req.ID, "command is required")
		return
	}
	if !strings.HasPrefix(command, "memory_") {
		_ = c.writeError(req.ID, "unsupported memory command")
		return
	}

	argsJSON := strings.TrimSpace(string(body.Args))
	if argsJSON == "" {
		argsJSON = "{}"
	}
	if !json.Valid([]byte(argsJSON)) {
		_ = c.writeError(req.ID, "memory args must be valid JSON")
		return
	}

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_MemoryManage{
			MemoryManage: &gatewayv1.MemoryManageRequest{
				Command:  command,
				ArgsJson: argsJSON,
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

	resp := response.GetMemoryManageResp()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	payloadValue, err := unmarshalJSONPayload(resp.GetResultJson())
	if err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}
	_ = c.writeResponse(req.ID, payloadValue)
}
