package server

import (
	"strings"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func (c *websocketConnection) handleSftpRequest(req websocketRequest) {
	action := sftpActionFromRequestType(req.Type)

	var body websocketSftpRequestPayload
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid "+req.Type+" payload")
		return
	}
	if !c.sm.WebSshTerminalEnabled() {
		_ = c.writeError(req.ID, "web SSH SFTP is disabled in desktop Remote settings")
		return
	}

	side := strings.TrimSpace(body.Side)
	if side == "" {
		side = strings.TrimSpace(body.Direction)
	}
	direction := strings.TrimSpace(body.Direction)
	if direction == "" {
		direction = side
	}
	sessionID := firstNonEmptyTrimmed(body.SessionID, body.SessionIDCamel)
	projectPathKey := firstNonEmptyTrimmed(body.ProjectPathKey, body.ProjectPathKeyCamel)
	localPath := firstNonEmptyRaw(body.LocalPath, body.LocalPathCamel)
	remotePath := firstNonEmptyRaw(body.RemotePath, body.RemotePathCamel)
	fromPath := firstNonEmptyRaw(
		body.FromPath,
		body.FromPathCamel,
		body.SourcePathCamel,
		body.TransferID,
		body.TransferIDCamel,
	)
	toPath := firstNonEmptyRaw(body.ToPath, body.ToPathCamel)
	targetPath := firstNonEmptyRaw(body.TargetPath, body.TargetPathCamel)

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_SftpRequest{
			SftpRequest: &gatewayv1.SftpRequest{
				Action:         action,
				SessionId:      sessionID,
				ProjectPathKey: projectPathKey,
				Workdir:        strings.TrimSpace(body.Workdir),
				LocalPath:      localPath,
				RemotePath:     remotePath,
				FromPath:       fromPath,
				ToPath:         toPath,
				Direction:      direction,
				TargetPath:     targetPath,
				Recursive:      body.Recursive,
				Overwrite:      body.Overwrite,
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

	resp := response.GetSftpResponse()
	if resp == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}
	_ = c.writeResponse(req.ID, websocketSftpResponsePayload(resp))
}

func sftpActionFromRequestType(requestType string) string {
	const prefix = "sftp."
	if strings.HasPrefix(requestType, prefix) {
		return strings.TrimSpace(strings.TrimPrefix(requestType, prefix))
	}
	return strings.TrimSpace(requestType)
}

func firstNonEmptyTrimmed(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func firstNonEmptyRaw(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func websocketSftpResponsePayload(resp *gatewayv1.SftpResponse) map[string]any {
	payload := map[string]any{
		"action":  strings.TrimSpace(resp.GetAction()),
		"path":    resp.GetPath(),
		"exists":  resp.GetExists(),
		"entries": websocketSftpEntriesPayload(resp.GetEntries()),
	}
	if entry := resp.GetEntry(); entry != nil {
		payload["entry"] = websocketSftpEntryPayload(entry)
	}
	if transfer := resp.GetTransfer(); transfer != nil {
		payload["transfer"] = websocketSftpTransferPayload(transfer)
	}
	return payload
}

func websocketSftpEventPayload(event *gatewayv1.SftpEvent) map[string]any {
	payload := map[string]any{
		"kind": strings.TrimSpace(event.GetKind()),
	}
	if transfer := event.GetTransfer(); transfer != nil {
		payload["transfer"] = websocketSftpTransferPayload(transfer)
	}
	return payload
}

func websocketSftpEntriesPayload(entries []*gatewayv1.SftpEntry) []map[string]any {
	payload := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		payload = append(payload, websocketSftpEntryPayload(entry))
	}
	return payload
}

func websocketSftpEntryPayload(entry *gatewayv1.SftpEntry) map[string]any {
	return map[string]any{
		"path":       entry.GetPath(),
		"name":       entry.GetName(),
		"kind":       strings.TrimSpace(entry.GetKind()),
		"sizeBytes":  entry.GetSizeBytes(),
		"size_bytes": entry.GetSizeBytes(),
		"mtime":      entry.GetMtime(),
	}
}

func websocketSftpTransferPayload(transfer *gatewayv1.SftpTransfer) map[string]any {
	return map[string]any{
		"id":           strings.TrimSpace(transfer.GetId()),
		"sessionId":    strings.TrimSpace(transfer.GetSessionId()),
		"session_id":   strings.TrimSpace(transfer.GetSessionId()),
		"direction":    strings.TrimSpace(transfer.GetDirection()),
		"status":       strings.TrimSpace(transfer.GetStatus()),
		"sourcePath":   transfer.GetSourcePath(),
		"source_path":  transfer.GetSourcePath(),
		"targetPath":   transfer.GetTargetPath(),
		"target_path":  transfer.GetTargetPath(),
		"currentPath":  transfer.GetCurrentPath(),
		"current_path": transfer.GetCurrentPath(),
		"bytesDone":    transfer.GetBytesDone(),
		"bytes_done":   transfer.GetBytesDone(),
		"bytesTotal":   transfer.GetBytesTotal(),
		"bytes_total":  transfer.GetBytesTotal(),
		"filesDone":    transfer.GetFilesDone(),
		"files_done":   transfer.GetFilesDone(),
		"filesTotal":   transfer.GetFilesTotal(),
		"files_total":  transfer.GetFilesTotal(),
		"error":        strings.TrimSpace(transfer.GetError()),
	}
}
