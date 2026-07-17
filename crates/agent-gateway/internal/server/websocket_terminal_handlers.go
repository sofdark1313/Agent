package server

import (
	"strings"
	"time"

	"google.golang.org/protobuf/proto"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func terminalActionFromRequestType(requestType string) string {
	return strings.TrimPrefix(strings.TrimSpace(requestType), "terminal.")
}

func (c *websocketConnection) terminalFeaturesEnabled() bool {
	return c.sm.WebTerminalEnabled() || c.sm.WebSshTerminalEnabled()
}

func (c *websocketConnection) terminalSessionAllowed(session *gatewayv1.TerminalSession) bool {
	if session == nil {
		return false
	}
	if terminalSessionKind(session) == "ssh" {
		return c.sm.WebSshTerminalEnabled()
	}
	return c.sm.WebTerminalEnabled()
}

func (c *websocketConnection) terminalEventAllowed(event *gatewayv1.TerminalEvent) bool {
	if event == nil {
		return false
	}
	if strings.TrimSpace(event.GetKind()) == "ssh_tabs_updated" {
		return c.sm.WebSshTerminalEnabled()
	}
	if session := event.GetSession(); session != nil {
		return c.terminalSessionAllowed(session)
	}
	sessionID := strings.TrimSpace(event.GetSessionId())
	if sessionID != "" && c.sm.TerminalSessionKind(sessionID) == "ssh" {
		return c.sm.WebSshTerminalEnabled()
	}
	return c.sm.WebTerminalEnabled()
}

func (c *websocketConnection) handleTerminalRequest(req websocketRequest) {
	action := terminalActionFromRequestType(req.Type)

	var body websocketTerminalRequestPayload
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid "+req.Type+" payload")
		return
	}
	if !c.terminalRequestAllowed(action, body) {
		_ = c.writeError(req.ID, terminalPermissionError(action))
		return
	}

	cols, err := websocketOptionalUint32(body.Cols, "cols")
	if err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}
	rows, err := websocketOptionalUint32(body.Rows, "rows")
	if err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}
	maxBytes, err := websocketOptionalUint32(body.MaxBytes, "max_bytes")
	if err != nil {
		_ = c.writeError(req.ID, err.Error())
		return
	}
	projectPathKey := strings.TrimSpace(body.ProjectPathKey)

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_TerminalRequest{
			TerminalRequest: &gatewayv1.TerminalRequest{
				Action:         action,
				SessionId:      strings.TrimSpace(body.SessionID),
				ProjectPathKey: projectPathKey,
				Cwd:            strings.TrimSpace(body.Cwd),
				Shell:          strings.TrimSpace(body.Shell),
				Title:          strings.TrimSpace(body.Title),
				Data:           body.Data,
				Cols:           cols,
				Rows:           rows,
				MaxBytes:       maxBytes,
				SshHostId:      strings.TrimSpace(body.SshHostID),
				PromptId:       strings.TrimSpace(body.PromptID),
				PromptAnswer:   body.PromptAnswer,
				TrustHostKey:   body.TrustHostKey,
				SftpEnabled:    body.SftpEnabled,
				TabId:          strings.TrimSpace(body.TabID),
				TabKind:        strings.TrimSpace(body.TabKind),
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

	resp := response.GetTerminalResponse()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}
	resp = c.mergeTerminalListWithCachedSnapshot(action, projectPathKey, resp)
	c.sm.ApplyTerminalResponseSnapshot(action, projectPathKey, resp)
	filteredResp := c.filterTerminalResponseForPermissions(action, resp)
	c.rememberTerminalInterest(action, body, filteredResp)

	_ = c.writeResponse(req.ID, websocketTerminalResponsePayload(filteredResp))
}

func (c *websocketConnection) mergeTerminalListWithCachedSnapshot(
	action string,
	projectPathKey string,
	resp *gatewayv1.TerminalResponse,
) *gatewayv1.TerminalResponse {
	if resp == nil || strings.TrimSpace(action) != "list" {
		return resp
	}
	cachedSessions := c.sm.TerminalSessionSnapshot(projectPathKey)
	if len(cachedSessions) == 0 {
		return resp
	}
	seen := make(map[string]struct{}, len(resp.GetSessions()))
	for _, session := range resp.GetSessions() {
		id := strings.TrimSpace(session.GetId())
		if id != "" {
			seen[id] = struct{}{}
		}
	}
	merged := make([]*gatewayv1.TerminalSession, 0, len(resp.GetSessions())+len(cachedSessions))
	merged = append(merged, resp.GetSessions()...)
	changed := false
	for _, session := range cachedSessions {
		id := strings.TrimSpace(session.GetId())
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		merged = append(merged, session)
		changed = true
	}
	if !changed {
		return resp
	}
	clone := proto.CloneOf(resp)
	clone.Sessions = merged
	return clone
}

func (c *websocketConnection) filterTerminalResponseForPermissions(action string, resp *gatewayv1.TerminalResponse) *gatewayv1.TerminalResponse {
	if resp == nil || action != "list" {
		return resp
	}
	filtered := make([]*gatewayv1.TerminalSession, 0, len(resp.GetSessions()))
	changed := false
	for _, session := range resp.GetSessions() {
		if c.terminalSessionAllowed(session) {
			filtered = append(filtered, session)
		} else {
			changed = true
		}
	}
	if !changed {
		return resp
	}
	clone := proto.CloneOf(resp)
	clone.Sessions = filtered
	return clone
}

func (c *websocketConnection) rememberTerminalInterest(action string, body websocketTerminalRequestPayload, resp *gatewayv1.TerminalResponse) {
	projectPathKey := strings.TrimSpace(body.ProjectPathKey)
	sessionID := strings.TrimSpace(body.SessionID)
	if respSession := resp.GetSession(); respSession != nil {
		if projectPathKey == "" {
			projectPathKey = strings.TrimSpace(respSession.GetProjectPathKey())
		}
		if sessionID == "" {
			sessionID = strings.TrimSpace(respSession.GetId())
		}
	}

	switch action {
	case "list", "create", "create_ssh", "answer_ssh_prompt", "close_project":
		c.rememberTerminalProject(projectPathKey)
	}
}

func (c *websocketConnection) terminalRequestAllowed(action string, body websocketTerminalRequestPayload) bool {
	switch action {
	case "create_ssh", "answer_ssh_prompt", "cancel_ssh_prompt", "ssh_latency",
		"ssh_tabs_list", "ssh_tab_open", "ssh_tab_close":
		return c.sm.WebSshTerminalEnabled()
	case "list":
		return c.sm.WebTerminalEnabled() || c.sm.WebSshTerminalEnabled()
	case "close_project":
		return c.sm.WebTerminalEnabled() || c.sm.WebSshTerminalEnabled()
	case "rename", "close":
		if c.sm.TerminalSessionKind(body.SessionID) == "ssh" {
			return c.sm.WebSshTerminalEnabled()
		}
		return c.sm.WebTerminalEnabled()
	default:
		return c.sm.WebTerminalEnabled()
	}
}

func terminalPermissionError(action string) string {
	switch action {
	case "create_ssh", "answer_ssh_prompt", "cancel_ssh_prompt", "ssh_latency",
		"ssh_tabs_list", "ssh_tab_open", "ssh_tab_close":
		return "web SSH terminal is disabled in desktop Remote settings"
	default:
		return "web terminal is disabled in desktop Remote settings"
	}
}
