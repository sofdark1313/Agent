package server

import (
	"strings"
	"time"

	"github.com/liveagent/agent-gateway/internal/handler"
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (c *websocketConnection) handleUploadedImagePreview(req websocketRequest) {
	var body handler.UploadedImagePreviewRequestBody
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid files.preview payload")
		return
	}
	body.Workdir = strings.TrimSpace(body.Workdir)
	body.AbsolutePath = strings.TrimSpace(body.AbsolutePath)
	if body.Workdir == "" {
		_ = c.writeError(req.ID, "workdir is required")
		return
	}
	if body.AbsolutePath == "" {
		_ = c.writeError(req.ID, "absolute_path is required")
		return
	}

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_UploadedImagePreview{
			UploadedImagePreview: &gatewayv1.UploadedImagePreviewRequest{
				Workdir:      body.Workdir,
				AbsolutePath: body.AbsolutePath,
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

	resp := response.GetUploadedImagePreviewResp()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	_ = c.writeResponse(req.ID, map[string]any{
		"mimeType": resp.GetMimeType(),
		"data":     resp.GetData(),
	})
}
