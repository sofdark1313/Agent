package server

import (
	"time"

	"github.com/liveagent/agent-gateway/internal/handler"
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (c *websocketConnection) handleCronManage(req websocketRequest) {
	var body handler.CronManageRequestBody
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid cron.manage payload")
		return
	}
	if !c.sm.IsOnline() {
		_ = c.writeError(req.ID, "agent offline")
		return
	}

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_CronManage{
			CronManage: &gatewayv1.CronManageRequest{
				Action:   body.Action,
				TaskId:   body.TaskID,
				TaskJson: body.TaskJSON,
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

	resp := response.GetCronManageResp()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	_ = c.writeResponse(req.ID, map[string]any{
		"action":      resp.GetAction(),
		"result_json": resp.GetResultJson(),
	})
}
