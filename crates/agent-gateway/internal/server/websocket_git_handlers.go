package server

import (
	"strings"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func gitActionFromRequestType(requestType string) string {
	return strings.TrimPrefix(strings.TrimSpace(requestType), "git.")
}

func gitActionIsWrite(action string) bool {
	switch action {
	case "init", "switch_branch", "create_branch", "stage", "stage_all", "unstage", "unstage_all", "discard", "discard_all", "add_to_gitignore", "commit", "fetch", "pull", "set_remote", "push", "delete_branch", "rename_branch", "stash_push", "stash_pop":
		return true
	default:
		return false
	}
}

func (c *websocketConnection) handleGitRequest(req websocketRequest) {
	action := gitActionFromRequestType(req.Type)
	if gitActionIsWrite(action) && !c.sm.WebGitEnabled() {
		_ = c.writeError(req.ID, "web git is disabled in desktop Remote settings")
		return
	}

	var body websocketGitRequestPayload
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid "+req.Type+" payload")
		return
	}
	argsJSON := strings.TrimSpace(string(body.Args))
	if argsJSON == "" {
		argsJSON = "{}"
	}
	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_GitRequest{
			GitRequest: &gatewayv1.GitRequest{
				Action:   action,
				Workdir:  strings.TrimSpace(body.Workdir),
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
	resp := response.GetGitResponse()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}
	payload, err := unmarshalJSONPayload(resp.GetResultJson())
	if err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}
	_ = c.writeResponse(req.ID, payload)
}
