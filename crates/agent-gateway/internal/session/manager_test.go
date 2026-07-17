package session

import (
	"context"
	"errors"
	"testing"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func TestStatusBroadcastIdentifiesOnlineSessionReplacement(t *testing.T) {
	manager := NewManager()
	statuses, unsubscribe := manager.SubscribeStatus()
	defer unsubscribe()

	first := NewAgentSession(AuthSnapshot{SessionID: "session-1"})
	manager.SetSession(first)
	firstStatus := <-statuses
	if !firstStatus.Online || firstStatus.SessionID != "session-1" {
		t.Fatalf("first status = %#v, want online session-1", firstStatus)
	}

	second := NewAgentSession(AuthSnapshot{SessionID: "session-2"})
	manager.SetSession(second)
	t.Cleanup(func() { manager.ClearSession(second) })
	secondStatus := <-statuses
	if !secondStatus.Online || secondStatus.SessionID != "session-2" {
		t.Fatalf("replacement status = %#v, want online session-2", secondStatus)
	}
}

func TestRegisterStreamAndSendContextCorrelatesOnCapturedSession(t *testing.T) {
	manager := NewManager()
	sess := NewAgentSession(AuthSnapshot{SessionID: "session-1"})
	manager.SetSession(sess)
	t.Cleanup(func() { manager.ClearSession(sess) })

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	type registeredRequest struct {
		responses <-chan *gatewayv1.AgentEnvelope
		done      <-chan struct{}
		cleanup   func()
		err       error
	}
	registered := make(chan registeredRequest, 1)
	go func() {
		responses, done, cleanup, err := manager.RegisterStreamAndSendContext(
			ctx,
			"history-1",
			&gatewayv1.GatewayEnvelope{
				RequestId: "history-1",
				Payload: &gatewayv1.GatewayEnvelope_HistoryList{
					HistoryList: &gatewayv1.HistoryListRequest{Page: 1, PageSize: 80},
				},
			},
		)
		registered <- registeredRequest{responses: responses, done: done, cleanup: cleanup, err: err}
	}()

	var outbound *OutboundEnvelope
	select {
	case outbound = <-sess.Outbound():
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for captured-session request")
	}
	if outbound.GetRequestId() != "history-1" || outbound.GetHistoryList() == nil {
		t.Fatalf("outbound request = %#v", outbound.GatewayEnvelope)
	}
	outbound.Ack(nil)

	result := <-registered
	if result.err != nil {
		t.Fatalf("RegisterStreamAndSendContext: %v", result.err)
	}
	defer result.cleanup()

	manager.DispatchFromAgentForSession(sess, &gatewayv1.AgentEnvelope{
		RequestId: "history-1",
		Payload: &gatewayv1.AgentEnvelope_HistoryListResp{
			HistoryListResp: &gatewayv1.HistoryListResponse{TotalCount: 1},
		},
	})
	select {
	case response := <-result.responses:
		if response.GetHistoryListResp().GetTotalCount() != 1 {
			t.Fatalf("history response = %#v", response.GetHistoryListResp())
		}
	case <-result.done:
		t.Fatal("captured response stream closed before dispatch")
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for correlated response")
	}
}

func TestRegisterStreamAndSendContextDoesNotCrossSessionReplacement(t *testing.T) {
	manager := NewManager()
	first := NewAgentSession(AuthSnapshot{SessionID: "session-1"})
	manager.SetSession(first)

	// Saturate the captured session's outbound lane so register-and-send pauses
	// after correlation is installed but before delivery can complete.
	for i := 0; i < cap(first.toAgent); i += 1 {
		sent, err := first.TrySendToAgent(&gatewayv1.GatewayEnvelope{RequestId: "queued"})
		if err != nil || !sent {
			t.Fatalf("fill first session outbound at %d: sent=%v err=%v", i, sent, err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, _, _, err := manager.RegisterStreamAndSendContext(
			ctx,
			"history-replacement",
			&gatewayv1.GatewayEnvelope{
				RequestId: "history-replacement",
				Payload: &gatewayv1.GatewayEnvelope_HistoryList{
					HistoryList: &gatewayv1.HistoryListRequest{Page: 1, PageSize: 80},
				},
			},
		)
		result <- err
	}()

	deadline := time.Now().Add(time.Second)
	for {
		first.streamsMu.Lock()
		_, registered := first.streams["history-replacement"]
		first.streamsMu.Unlock()
		if registered {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("request stream was not registered on the captured session")
		}
		time.Sleep(time.Millisecond)
	}

	second := NewAgentSession(AuthSnapshot{SessionID: "session-2"})
	manager.SetSession(second)
	t.Cleanup(func() { manager.ClearSession(second) })
	if err := <-result; !errors.Is(err, ErrAgentOffline) {
		t.Fatalf("register-and-send across replacement = %v, want ErrAgentOffline", err)
	}

	select {
	case outbound := <-second.Outbound():
		t.Fatalf("request crossed into replacement session: %#v", outbound.GatewayEnvelope)
	default:
	}
}

func TestChatRuntimeProbeFreshnessIsBoundToSessionEpoch(t *testing.T) {
	manager := NewManager()
	first := NewAgentSession(AuthSnapshot{SessionID: "session-1"})
	manager.SetSession(first)

	firstEpoch, online := manager.ChatRuntimeProbeEpoch()
	if !online || firstEpoch == 0 {
		t.Fatalf("first probe epoch = %d online=%v", firstEpoch, online)
	}
	if !manager.RecordChatRuntimeProbe(firstEpoch) ||
		!manager.ChatRuntimeProbeFresh(time.Second) {
		t.Fatal("recorded probe should be fresh for the current session")
	}

	second := NewAgentSession(AuthSnapshot{SessionID: "session-2"})
	manager.SetSession(second)
	t.Cleanup(func() { manager.ClearSession(second) })
	if manager.ChatRuntimeProbeFresh(time.Second) {
		t.Fatal("replacing the agent session must invalidate probe freshness")
	}
	if manager.RecordChatRuntimeProbe(firstEpoch) {
		t.Fatal("an old session epoch must not mark the replacement session fresh")
	}

	secondEpoch, online := manager.ChatRuntimeProbeEpoch()
	if !online || secondEpoch == firstEpoch || !manager.RecordChatRuntimeProbe(secondEpoch) {
		t.Fatalf("replacement probe epoch = %d online=%v", secondEpoch, online)
	}
}

func TestApplySettingsJSONPreservingRemoteKeepsDesktopTerminalSetting(t *testing.T) {
	manager := NewManager()
	manager.ApplySettingsJSON(`{"remote":{"enableWebTerminal":true,"enableWebSshTerminal":true},"theme":"dark"}`)
	if !manager.WebTerminalEnabled() {
		t.Fatal("expected desktop settings sync to enable web terminal")
	}
	if !manager.WebSshTerminalEnabled() {
		t.Fatal("expected desktop settings sync to enable web SSH terminal")
	}

	manager.ApplySettingsJSONPreservingRemote(`{"remote":{"enableWebTerminal":false,"enableWebSshTerminal":false},"theme":"light"}`)
	if !manager.WebTerminalEnabled() {
		t.Fatal("settings.update must not disable the desktop-owned web terminal setting")
	}
	if !manager.WebSshTerminalEnabled() {
		t.Fatal("settings.update must not disable the desktop-owned web SSH terminal setting")
	}
}

func TestApplySettingsJSONKeepsRemoteWhenPublicSettingsEventOmitsIt(t *testing.T) {
	manager := NewManager()
	manager.ApplySettingsJSON(`{"remote":{"enableWebTerminal":true,"enableWebSshTerminal":true},"theme":"dark"}`)
	if !manager.WebTerminalEnabled() {
		t.Fatal("expected desktop settings sync to enable web terminal")
	}
	if !manager.WebSshTerminalEnabled() {
		t.Fatal("expected desktop settings sync to enable web SSH terminal")
	}

	manager.ApplySettingsJSON(`{"theme":"light"}`)
	if !manager.WebTerminalEnabled() {
		t.Fatal("public settings events without remote must not clear the desktop web terminal setting")
	}
	if !manager.WebSshTerminalEnabled() {
		t.Fatal("public settings events without remote must not clear the desktop web SSH terminal setting")
	}
}

func TestApplySettingsJSONPreservingRemoteDoesNotTrustIncomingRemote(t *testing.T) {
	manager := NewManager()
	manager.ApplySettingsJSONPreservingRemote(`{"remote":{"enableWebTerminal":true,"enableWebSshTerminal":true}}`)
	if manager.WebTerminalEnabled() {
		t.Fatal("settings.update must not enable web terminal without a desktop settings snapshot")
	}
	if manager.WebSshTerminalEnabled() {
		t.Fatal("settings.update must not enable web SSH terminal without a desktop settings snapshot")
	}
}

func TestTerminalSessionSnapshotPreservesSshMetadataAndSorts(t *testing.T) {
	manager := NewManager()
	manager.replaceTerminalSessionSnapshot("", []*gatewayv1.TerminalSession{
		{
			Id:             "ssh-2",
			ProjectPathKey: "/workspace/b",
			Cwd:            "/workspace/b",
			Shell:          "ssh",
			Title:          "Production 2",
			Kind:           "ssh",
			CreatedAt:      2,
			UpdatedAt:      2,
			Running:        true,
			Ssh: &gatewayv1.TerminalSshMetadata{
				HostId:   "prod-2",
				HostName: "Production 2",
				Username: "deploy",
				Host:     "prod-2.example.com",
				Port:     22,
				AuthType: "privateKey",
			},
		},
		{
			Id:             "local-1",
			ProjectPathKey: "/workspace/a",
			Cwd:            "/workspace/a",
			Shell:          "zsh",
			Title:          "Local",
			Kind:           "local",
			CreatedAt:      2,
			UpdatedAt:      2,
			Running:        true,
		},
		{
			Id:             "ssh-1",
			ProjectPathKey: "/workspace/a",
			Cwd:            "/workspace/a",
			Shell:          "ssh",
			Title:          "Production",
			Kind:           "ssh",
			CreatedAt:      1,
			UpdatedAt:      1,
			Running:        true,
			Ssh: &gatewayv1.TerminalSshMetadata{
				HostId:   "prod",
				HostName: "Production",
				Username: "deploy",
				Host:     "prod.example.com",
				Port:     22,
				AuthType: "password",
			},
		},
	})

	sessions := manager.TerminalSessionSnapshot("")
	if len(sessions) != 3 {
		t.Fatalf("terminal sessions = %d, want 3", len(sessions))
	}
	if got := []string{sessions[0].GetId(), sessions[1].GetId(), sessions[2].GetId()}; got[0] != "ssh-1" || got[1] != "local-1" || got[2] != "ssh-2" {
		t.Fatalf("terminal session order = %#v", got)
	}
	if manager.TerminalSessionKind("ssh-1") != "ssh" {
		t.Fatalf("TerminalSessionKind(ssh-1) = %q, want ssh", manager.TerminalSessionKind("ssh-1"))
	}
	if sessions[0].GetSsh().GetHostId() != "prod" || sessions[0].GetSsh().GetAuthType() != "password" {
		t.Fatalf("ssh metadata = %#v", sessions[0].GetSsh())
	}

	sessions[0].Ssh.HostId = "mutated"
	fresh := manager.TerminalSessionSnapshot("/workspace/a")
	if len(fresh) != 2 {
		t.Fatalf("filtered terminal sessions = %d, want 2", len(fresh))
	}
	if fresh[0].GetSsh().GetHostId() != "prod" {
		t.Fatalf("terminal snapshot should be immutable, got ssh host id %q", fresh[0].GetSsh().GetHostId())
	}
}

func TestActiveConversationActivitiesTracksRunLifecycle(t *testing.T) {
	manager := NewManager()

	manager.StartChatCommand("run-1", "conv-1", "/workspace", "client-1", nil)
	manager.ingestChatControl("run-1", &gatewayv1.ChatControlEvent{
		RequestId:      "run-1",
		ConversationId: "conv-1",
		Type:           "started",
		State:          "running",
	})

	activities := manager.ActiveConversationActivities()
	if len(activities) != 1 || activities[0].RunID != "run-1" || activities[0].State != RunActivityRunning {
		t.Fatalf("activities = %#v, want running run-1", activities)
	}

	manager.ingestChatControl("run-1", &gatewayv1.ChatControlEvent{
		RequestId:      "run-1",
		ConversationId: "conv-1",
		Type:           "completed",
		State:          "completed",
	})

	if activities := manager.ActiveConversationActivities(); len(activities) != 0 {
		t.Fatalf("completed run should not appear in activities, got %#v", activities)
	}
}
