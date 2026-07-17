package server

import (
	"encoding/json"
	"strings"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (c *websocketConnection) handleSkillFilesList(req websocketRequest) {
	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_SkillFilesList{
			SkillFilesList: &gatewayv1.SkillFilesListRequest{},
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

	resp := response.GetSkillFilesListResp()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	_ = c.writeResponse(req.ID, map[string]any{
		"rootDir":   resp.GetRootDir(),
		"paths":     resp.GetPaths(),
		"truncated": resp.GetTruncated(),
	})
}

func (c *websocketConnection) handleFileMentionList(req websocketRequest) {
	type payload struct {
		Workdir    string `json:"workdir"`
		MaxResults *int   `json:"max_results"`
		Query      string `json:"query"`
	}

	var body payload
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid mentions.list payload")
		return
	}

	workdir := strings.TrimSpace(body.Workdir)
	if workdir == "" {
		_ = c.writeError(req.ID, "workdir is required")
		return
	}
	query := strings.TrimSpace(body.Query)

	maxResults, err := websocketOptionalUint32(body.MaxResults, "max_results")
	if err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_FileMentionList{
			FileMentionList: &gatewayv1.FileMentionListRequest{
				Workdir:    workdir,
				MaxResults: maxResults,
				Query:      query,
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

	resp := response.GetFileMentionListResp()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	entries := make([]map[string]any, 0, len(resp.GetEntries()))
	for _, entry := range resp.GetEntries() {
		entries = append(entries, map[string]any{
			"path": entry.GetPath(),
			"kind": entry.GetKind(),
		})
	}

	_ = c.writeResponse(req.ID, map[string]any{
		"entries":   entries,
		"truncated": resp.GetTruncated(),
	})
}

func (c *websocketConnection) handleSkillMetadataRead(req websocketRequest) {
	type payload struct {
		Path string `json:"path"`
	}

	var body payload
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid skills.read-metadata payload")
		return
	}

	path := strings.TrimSpace(body.Path)
	if path == "" {
		_ = c.writeError(req.ID, "path is required")
		return
	}

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_SkillMetadataRead{
			SkillMetadataRead: &gatewayv1.SkillMetadataReadRequest{
				Path: path,
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

	resp := response.GetSkillMetadataReadResp()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	name := strings.TrimSpace(resp.GetName())
	description := strings.TrimSpace(resp.GetDescription())
	result := map[string]any{"name": any(nil), "description": any(nil)}
	if name != "" {
		result["name"] = name
	}
	if description != "" {
		result["description"] = description
	}
	_ = c.writeResponse(req.ID, result)
}

func (c *websocketConnection) handleSkillTextRead(req websocketRequest) {
	type payload struct {
		Path   string `json:"path"`
		Offset *int   `json:"offset"`
		Length *int   `json:"length"`
	}

	var body payload
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid skills.read-text payload")
		return
	}

	path := strings.TrimSpace(body.Path)
	if path == "" {
		_ = c.writeError(req.ID, "path is required")
		return
	}

	offset, err := websocketOptionalUint32(body.Offset, "offset")
	if err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}
	length, err := websocketOptionalUint32(body.Length, "length")
	if err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_SkillTextRead{
			SkillTextRead: &gatewayv1.SkillTextReadRequest{
				Path:   path,
				Offset: offset,
				Length: length,
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

	resp := response.GetSkillTextReadResp()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	_ = c.writeResponse(req.ID, map[string]any{
		"content":   resp.GetContent(),
		"truncated": resp.GetTruncated(),
	})
}

func (c *websocketConnection) handleSkillManage(req websocketRequest) {
	payloadJSON := strings.TrimSpace(string(req.Payload))
	if payloadJSON == "" || payloadJSON == "null" {
		payloadJSON = "{}"
	}
	if !json.Valid([]byte(payloadJSON)) {
		_ = c.writeError(req.ID, "invalid skills.manage payload")
		return
	}

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_SkillManage{
			SkillManage: &gatewayv1.SkillManageRequest{
				PayloadJson: payloadJSON,
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

	resp := response.GetSkillManageResp()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	var payload any
	raw := strings.TrimSpace(resp.GetResultJson())
	if raw == "" {
		payload = map[string]any{}
	} else if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		_ = c.writeError(req.ID, "skill manage response is not valid JSON")
		return
	}

	_ = c.writeResponse(req.ID, payload)
}
