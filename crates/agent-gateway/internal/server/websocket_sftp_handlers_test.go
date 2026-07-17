package server

import (
	"testing"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func TestFirstNonEmptyRawPreservesSftpPathWhitespace(t *testing.T) {
	t.Parallel()

	if got := firstNonEmptyRaw("", "  spaced path  "); got != "  spaced path  " {
		t.Fatalf("firstNonEmptyRaw preserved path = %q", got)
	}
	if got := firstNonEmptyRaw("   ", "fallback"); got != "   " {
		t.Fatalf("firstNonEmptyRaw all-space path = %q", got)
	}
}

func TestWebsocketSftpPayloadPreservesPathWhitespace(t *testing.T) {
	t.Parallel()

	payload := websocketSftpResponsePayload(&gatewayv1.SftpResponse{
		Action: " list ",
		Path:   "  remote dir  ",
		Entries: []*gatewayv1.SftpEntry{
			{
				Path: "  remote dir/file  ",
				Name: "  file  ",
				Kind: " file ",
			},
		},
		Transfer: &gatewayv1.SftpTransfer{
			Id:          " transfer-1 ",
			SessionId:   " session-1 ",
			Direction:   " upload ",
			Status:      " running ",
			SourcePath:  "  local file  ",
			TargetPath:  "  remote dir  ",
			CurrentPath: "  remote dir/file  ",
		},
	})

	if got := payload["action"]; got != "list" {
		t.Fatalf("action = %#v", got)
	}
	if got := payload["path"]; got != "  remote dir  " {
		t.Fatalf("path = %#v", got)
	}

	entries := payload["entries"].([]map[string]any)
	if got := entries[0]["path"]; got != "  remote dir/file  " {
		t.Fatalf("entry path = %#v", got)
	}
	if got := entries[0]["name"]; got != "  file  " {
		t.Fatalf("entry name = %#v", got)
	}
	if got := entries[0]["kind"]; got != "file" {
		t.Fatalf("entry kind = %#v", got)
	}

	transfer := payload["transfer"].(map[string]any)
	if got := transfer["id"]; got != "transfer-1" {
		t.Fatalf("transfer id = %#v", got)
	}
	if got := transfer["sourcePath"]; got != "  local file  " {
		t.Fatalf("sourcePath = %#v", got)
	}
	if got := transfer["targetPath"]; got != "  remote dir  " {
		t.Fatalf("targetPath = %#v", got)
	}
	if got := transfer["currentPath"]; got != "  remote dir/file  " {
		t.Fatalf("currentPath = %#v", got)
	}
}
