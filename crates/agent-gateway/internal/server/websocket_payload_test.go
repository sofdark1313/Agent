package server

import (
	"testing"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/session"
)

func TestWebsocketChatActivityPayloadCarriesRunIdentity(t *testing.T) {
	updatedAt := time.UnixMilli(123456)
	payload := websocketChatActivityPayload(session.ConversationActivityEvent{
		ConversationID: "conversation-1",
		RunID:          "run-1",
		Running:        true,
		State:          "running",
		Workdir:        "/workspace",
		UpdatedAt:      updatedAt,
	})
	if payload["conversation_id"] != "conversation-1" ||
		payload["run_id"] != "run-1" ||
		payload["running"] != true ||
		payload["state"] != "running" ||
		payload["workdir"] != "/workspace" ||
		payload["updated_at"] != int64(123456) {
		t.Fatalf("chat activity payload = %#v", payload)
	}

	idle := websocketChatActivityPayload(session.ConversationActivityEvent{
		ConversationID: "conversation-1",
		Running:        false,
		UpdatedAt:      updatedAt,
	})
	if idle["running"] != false {
		t.Fatalf("idle activity payload = %#v", idle)
	}
	if _, hasRunID := idle["run_id"]; hasRunID {
		t.Fatalf("idle activity should omit empty run_id: %#v", idle)
	}
}

func TestWebsocketRunActivityAndSnapshotPayloads(t *testing.T) {
	updatedAt := time.UnixMilli(7890)
	activity := websocketRunActivityPayload(&session.RunActivity{
		RunID:                  "run-1",
		ClientRequestID:        "client-1",
		State:                  "running",
		ToolStatus:             "Vibing",
		ToolStatusIsCompaction: false,
		StartedSeq:             17,
		UpdatedAt:              updatedAt,
	})
	if activity["run_id"] != "run-1" ||
		activity["state"] != "running" ||
		activity["started_seq"] != int64(17) ||
		activity["tool_status"] != "Vibing" ||
		activity["client_request_id"] != "client-1" {
		t.Fatalf("run activity payload = %#v", activity)
	}
	if payload := websocketRunActivityPayload(nil); payload != nil {
		t.Fatalf("nil activity payload = %#v, want nil", payload)
	}

	snapshot := websocketRunSnapshotPayload(&session.RunSnapshot{
		RunID:       "run-1",
		Revision:    3,
		EntriesJSON: `[{"kind":"assistant"}]`,
		ToolStatus:  "Compacting",
	})
	if snapshot["run_id"] != "run-1" ||
		snapshot["revision"] != int64(3) ||
		snapshot["entries_json"] != `[{"kind":"assistant"}]` {
		t.Fatalf("run snapshot payload = %#v", snapshot)
	}
	if payload := websocketRunSnapshotPayload(nil); payload != nil {
		t.Fatalf("nil snapshot payload = %#v, want nil", payload)
	}
}

func TestWebsocketChatQueueSnapshotResponsePayload(t *testing.T) {
	payload := websocketChatQueueSnapshotResponsePayload(&gatewayv1.ChatQueueEvent{
		ConversationId: "conversation-1",
		SnapshotJson:   `{"conversationId":"conversation-1","revision":3,"items":[{"id":"queue-1"}]}`,
		Revision:       3,
	})

	if payload["accepted"] != true ||
		payload["snapshot_json"] != `{"conversationId":"conversation-1","revision":3,"items":[{"id":"queue-1"}]}` ||
		payload["revision"] != uint64(3) ||
		payload["error_code"] != "" {
		t.Fatalf("chat queue snapshot response payload = %#v", payload)
	}
}

func TestWebsocketTerminalPayloadsPreserveOutputOffsets(t *testing.T) {
	response := websocketTerminalResponsePayload(&gatewayv1.TerminalResponse{
		Action:            "attach",
		Output:            []byte("uploads\n"),
		OutputStartOffset: 8,
		OutputEndOffset:   16,
	})
	if response["output_start_offset"] != uint64(8) {
		t.Fatalf("terminal response output_start_offset = %#v, want 8", response["output_start_offset"])
	}
	if response["output_end_offset"] != uint64(16) {
		t.Fatalf("terminal response output_end_offset = %#v, want 16", response["output_end_offset"])
	}

	event := websocketTerminalEventPayload(&gatewayv1.TerminalEvent{
		Kind:              "output",
		SessionId:         "terminal-1",
		ProjectPathKey:    "/workspace/project",
		Data:              []byte("uploads\n"),
		OutputStartOffset: 16,
		OutputEndOffset:   24,
	})
	if event["output_start_offset"] != uint64(16) {
		t.Fatalf("terminal event output_start_offset = %#v, want 16", event["output_start_offset"])
	}
	if event["output_end_offset"] != uint64(24) {
		t.Fatalf("terminal event output_end_offset = %#v, want 24", event["output_end_offset"])
	}
}

func TestWebsocketTerminalPayloadsIncludeSshTabsSnapshot(t *testing.T) {
	response := websocketTerminalResponsePayload(&gatewayv1.TerminalResponse{
		Action: "ssh_tabs_list",
		SshTabs: &gatewayv1.TerminalSshTabsSnapshot{
			ProjectPathKey: "/workspace/project",
			Revision:       7,
			Tabs: []*gatewayv1.TerminalSshTab{
				{
					Id:             "bash:ssh-1",
					SessionId:      "ssh-1",
					ProjectPathKey: "/workspace/project",
					Kind:           "bash",
					CreatedAt:      10,
					UpdatedAt:      12,
				},
			},
		},
	})
	snapshot, ok := response["ssh_tabs"].(map[string]any)
	if !ok {
		t.Fatalf("ssh_tabs payload missing: %#v", response)
	}
	if snapshot["project_path_key"] != "/workspace/project" || snapshot["revision"] != uint64(7) {
		t.Fatalf("ssh_tabs snapshot = %#v", snapshot)
	}
	tabs, ok := snapshot["tabs"].([]map[string]any)
	if !ok || len(tabs) != 1 {
		t.Fatalf("ssh_tabs tabs = %#v", snapshot["tabs"])
	}
	if tabs[0]["session_id"] != "ssh-1" || tabs[0]["kind"] != "bash" {
		t.Fatalf("ssh_tabs tab = %#v", tabs[0])
	}
}

func TestWebsocketProtoPayloadPreservesFrontendNumberTypes(t *testing.T) {
	payload := websocketConversationSummaryPayload(&gatewayv1.ConversationSummary{
		Id:           "conversation-1",
		CreatedAt:    42,
		UpdatedAt:    84,
		MessageCount: 3,
	})

	if got := payload["created_at"]; got != int64(42) {
		t.Fatalf("created_at = %#v (%T), want int64(42)", got, got)
	}
	if got := payload["updated_at"]; got != int64(84) {
		t.Fatalf("updated_at = %#v (%T), want int64(84)", got, got)
	}
	if got := payload["message_count"]; got != int32(3) {
		t.Fatalf("message_count = %#v (%T), want int32(3)", got, got)
	}
}

func TestWebsocketProtoPayloadPreservesNilPayloads(t *testing.T) {
	if payload := websocketConversationSummaryPayload(nil); payload != nil {
		t.Fatalf("conversation nil payload = %#v, want nil", payload)
	}
	if payload := websocketHistoryShareStatusPayload(nil); payload != nil {
		t.Fatalf("history share nil payload = %#v, want nil", payload)
	}
	if payload := websocketTerminalShellOptionPayload(nil); payload != nil {
		t.Fatalf("terminal shell option nil payload = %#v, want nil", payload)
	}
}

func TestWebsocketFsPayloadsUseFrontendFieldNames(t *testing.T) {
	list := websocketFsListResponsePayload(&gatewayv1.FsListResponse{
		Path:       "src",
		HasPath:    true,
		Depth:      1,
		Offset:     2,
		MaxResults: 50,
		Total:      3,
		HasMore:    true,
		Entries: []*gatewayv1.FsListEntry{
			{Path: "src/components", Kind: "dir"},
			{Path: "src/app.tsx", Kind: "file"},
		},
	})
	if list["path"] != "src" {
		t.Fatalf("fs.list path = %#v, want src", list["path"])
	}
	if list["maxResults"] != uint32(50) {
		t.Fatalf("fs.list maxResults = %#v, want 50", list["maxResults"])
	}
	if list["hasMore"] != true {
		t.Fatalf("fs.list hasMore = %#v, want true", list["hasMore"])
	}
	entries, ok := list["entries"].([]map[string]any)
	if !ok || len(entries) != 2 {
		t.Fatalf("fs.list entries = %#v, want two entry maps", list["entries"])
	}
	if entries[0]["path"] != "src/components" || entries[0]["kind"] != "dir" {
		t.Fatalf("fs.list first entry = %#v", entries[0])
	}

	readEditable := websocketFsReadEditableTextResponsePayload(&gatewayv1.FsReadEditableTextResponse{
		Path:        "src/main.ts",
		Content:     "export {};\n",
		MtimeMs:     42,
		ContentHash: "hash",
		SizeBytes:   11,
		TotalLines:  1,
	})
	if readEditable["content"] != "export {};\n" {
		t.Fatalf("fs.read_editable_text content = %#v", readEditable["content"])
	}
	if readEditable["sizeBytes"] != uint64(11) {
		t.Fatalf("fs.read_editable_text sizeBytes = %#v, want 11", readEditable["sizeBytes"])
	}

	readWorkspaceImage := websocketFsReadWorkspaceImageResponsePayload(&gatewayv1.FsReadWorkspaceImageResponse{
		Path:        "assets/preview.png",
		MimeType:    "image/png",
		Data:        "base64",
		SizeBytes:   6,
		MtimeMs:     42,
		ContentHash: "hash",
	})
	if readWorkspaceImage["mimeType"] != "image/png" {
		t.Fatalf("fs.read_workspace_image mimeType = %#v", readWorkspaceImage["mimeType"])
	}
	if readWorkspaceImage["sizeBytes"] != uint64(6) {
		t.Fatalf("fs.read_workspace_image sizeBytes = %#v, want 6", readWorkspaceImage["sizeBytes"])
	}
	if readWorkspaceImage["contentHash"] != "hash" {
		t.Fatalf("fs.read_workspace_image contentHash = %#v", readWorkspaceImage["contentHash"])
	}

	write := websocketFsWriteTextResponsePayload(&gatewayv1.FsWriteTextResponse{
		Path:          "src/new.ts",
		Mode:          "rewrite",
		ExistedBefore: false,
		BytesWritten:  12,
		MtimeMs:       42,
		ContentHash:   "hash",
		TotalLines:    1,
	})
	if write["existedBefore"] != false {
		t.Fatalf("fs.write_text existedBefore = %#v, want false", write["existedBefore"])
	}
	if write["bytesWritten"] != uint64(12) {
		t.Fatalf("fs.write_text bytesWritten = %#v, want 12", write["bytesWritten"])
	}
	if write["mtimeMs"] != uint64(42) {
		t.Fatalf("fs.write_text mtimeMs = %#v, want 42", write["mtimeMs"])
	}
	if write["totalLines"] != uint64(1) {
		t.Fatalf("fs.write_text totalLines = %#v, want 1", write["totalLines"])
	}

	createDir := websocketFsCreateDirResponsePayload(&gatewayv1.FsCreateDirResponse{
		Path: "src/new-folder",
		Kind: "dir",
	})
	if createDir["path"] != "src/new-folder" || createDir["kind"] != "dir" {
		t.Fatalf("fs.create_dir payload = %#v", createDir)
	}

	rename := websocketFsRenameResponsePayload(&gatewayv1.FsRenameResponse{
		FromPath: "src/old.ts",
		Path:     "src/new.ts",
		Kind:     "file",
	})
	if rename["fromPath"] != "src/old.ts" {
		t.Fatalf("fs.rename fromPath = %#v, want src/old.ts", rename["fromPath"])
	}
	if rename["path"] != "src/new.ts" || rename["kind"] != "file" {
		t.Fatalf("fs.rename payload = %#v", rename)
	}

	deletePayload := websocketFsDeleteResponsePayload(&gatewayv1.FsDeleteResponse{
		Path: "src/new.ts",
		Kind: "file",
	})
	if deletePayload["path"] != "src/new.ts" || deletePayload["kind"] != "file" {
		t.Fatalf("fs.delete payload = %#v", deletePayload)
	}
}
