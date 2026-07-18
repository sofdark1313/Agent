package server

import (
	"testing"
)

func TestWebsocketRequestHandlersCoverKnownProtocolTypes(t *testing.T) {
	t.Parallel()

	expectedTypes := []string{
		"status.get",
		"fs.roots",
		"fs.list_dirs",
		"fs.create_project_folder",
		"fs.list",
		"fs.read_editable_text",
		"fs.read_workspace_image",
		"fs.write_text",
		"fs.create_dir",
		"fs.rename",
		"fs.delete",
		"history.list",
		"history.workdirs",
		"history.shared_list",
		"history.get",
		"history.prefix",
		"history.rename",
		"history.pin",
		"history.share.get",
		"history.share.set",
		"history.delete",
		"providers.list",
		"settings.get",
		"settings.update",
		"settings.ssh_known_host.reset",
		"skills.list",
		"mentions.list",
		"skills.read-metadata",
		"skills.read-text",
		"skills.manage",
		"files.preview",
		"memory.manage",
		"terminal.shell_options",
		"terminal.list",
		"terminal.create",
		"terminal.create_ssh",
		"terminal.answer_ssh_prompt",
		"terminal.cancel_ssh_prompt",
		"terminal.ssh_latency",
		"terminal.ssh_tabs_list",
		"terminal.ssh_tab_open",
		"terminal.ssh_tab_close",
		"terminal.rename",
		"terminal.close",
		"terminal.close_project",
		"sftp.list",
		"sftp.stat",
		"sftp.mkdir",
		"sftp.rename",
		"sftp.delete",
		"sftp.transfer",
		"sftp.cancel",
		"tunnel.create",
		"tunnel.update",
		"tunnel.close",
		"tunnel.check",
		"process.snapshot",
		"process.stop",
		"process.read_log",
		"process.clear",
		"git.status",
		"git.branches",
		"git.init",
		"git.switch_branch",
		"git.create_branch",
		"git.diff",
		"git.log",
		"git.commit_details",
		"git.compare_commit_with_remote",
		"git.commit_diff",
		"git.stage",
		"git.stage_all",
		"git.unstage",
		"git.unstage_all",
		"git.discard",
		"git.discard_all",
		"git.add_to_gitignore",
		"git.commit",
		"git.fetch",
		"git.pull",
		"git.set_remote",
		"git.push",
		"git.delete_branch",
		"git.rename_branch",
		"git.stash_push",
		"git.stash_pop",
		"cron.manage",
		"provider.models",
		"chat.subscribe",
		"chat.unsubscribe",
		"workspace.subscribe",
		"workspace.unsubscribe",
		"chat.activities",
		"chat.prepare",
		"chat.command",
		"chat.cancel",
		"chat_queue.get",
		"chat_queue.get_item",
		"chat_queue.run_now",
		"chat_queue.move",
		"chat_queue.remove",
		"chat_queue.edit_begin",
		"chat_queue.edit_commit",
		"chat_queue.edit_cancel",
	}

	for _, requestType := range expectedTypes {
		if websocketRequestHandlers[requestType] == nil {
			t.Fatalf("websocketRequestHandlers[%q] is missing", requestType)
		}
	}
	if got := len(websocketRequestHandlers); got != len(expectedTypes) {
		t.Fatalf("websocketRequestHandlers has %d entries, want %d", got, len(expectedTypes))
	}

	for _, removedType := range []string{
		"history.truncate",
		"chat.start",
		"chat.resume",
		"chat.attach",
		"chat.detach",
		"terminal.attach",
		"terminal.input",
		"terminal.resize",
		"terminal.detach",
	} {
		if websocketRequestHandlers[removedType] != nil {
			t.Fatalf("websocketRequestHandlers[%q] should be removed; terminal bytes use /ws/terminal", removedType)
		}
	}
}

func TestGitActionIsWrite(t *testing.T) {
	t.Parallel()

	for _, action := range []string{"delete_branch", "rename_branch", "stash_push", "stash_pop"} {
		if !gitActionIsWrite(action) {
			t.Fatalf("gitActionIsWrite(%q) = false, want true", action)
		}
	}
	for _, action := range []string{"status", "branches", "diff", "log"} {
		if gitActionIsWrite(action) {
			t.Fatalf("gitActionIsWrite(%q) = true, want false", action)
		}
	}
}

func TestDecodeWebSocketPayloadRejectsUnknownFields(t *testing.T) {
	t.Parallel()

	var empty struct{}
	if err := decodeWebSocketPayload(nil, &empty); err != nil {
		t.Fatalf("decode empty payload: %v", err)
	}

	var payload struct {
		Known string `json:"known"`
	}
	if err := decodeWebSocketPayload([]byte(`{"known":"ok","unknown":true}`), &payload); err == nil {
		t.Fatal("expected unknown payload field to be rejected")
	}
}
