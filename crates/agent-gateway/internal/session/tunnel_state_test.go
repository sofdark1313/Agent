package session

import (
	"strings"
	"testing"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func newTunnelTestManager(t *testing.T) *Manager {
	t.Helper()
	m := NewManager()
	m.SetSession(NewAgentSession(AuthSnapshot{AgentID: "test-agent"}))
	return m
}

func desiredState(specs ...*gatewayv1.TunnelSpec) *gatewayv1.TunnelDesiredState {
	return &gatewayv1.TunnelDesiredState{Tunnels: specs}
}

func findTunnelStatus(snapshot *gatewayv1.TunnelStateSnapshot, id string) *gatewayv1.TunnelStatus {
	for _, tunnel := range snapshot.GetTunnels() {
		if tunnel.GetId() == id {
			return tunnel
		}
	}
	return nil
}

func TestApplyDesiredStateAddUpdateRemove(t *testing.T) {
	m := newTunnelTestManager(t)

	m.ApplyDesiredState(desiredState(
		&gatewayv1.TunnelSpec{Id: "tun-a", TargetUrl: "http://localhost:3000", Name: "a"},
		&gatewayv1.TunnelSpec{Id: "tun-b", TargetUrl: "http://localhost:4000"},
	))
	snapshot := m.TunnelStateSnapshot()
	if len(snapshot.GetTunnels()) != 2 {
		t.Fatalf("tunnels = %d, want 2", len(snapshot.GetTunnels()))
	}
	statusA := findTunnelStatus(snapshot, "tun-a")
	if statusA == nil || statusA.GetSlug() == "" {
		t.Fatalf("tun-a missing or has no slug: %#v", statusA)
	}
	if statusA.GetPublicPath() != "/t/"+statusA.GetSlug()+"/" {
		t.Fatalf("public path = %q", statusA.GetPublicPath())
	}
	slugA := statusA.GetSlug()

	// Update keeps the allocated slug; removal drops the record.
	m.ApplyDesiredState(desiredState(
		&gatewayv1.TunnelSpec{Id: "tun-a", TargetUrl: "http://localhost:3001", Name: "renamed"},
	))
	snapshot = m.TunnelStateSnapshot()
	if len(snapshot.GetTunnels()) != 1 {
		t.Fatalf("tunnels after removal = %d, want 1", len(snapshot.GetTunnels()))
	}
	statusA = findTunnelStatus(snapshot, "tun-a")
	if statusA.GetSlug() != slugA {
		t.Fatalf("slug changed across update: %q -> %q", slugA, statusA.GetSlug())
	}
	if statusA.GetTargetUrl() != "http://localhost:3001" || statusA.GetName() != "renamed" {
		t.Fatalf("update not applied: %#v", statusA)
	}
}

func TestApplyDesiredStateHonorsSlugHintAndCollision(t *testing.T) {
	m := newTunnelTestManager(t)
	hint := strings.Repeat("a", 32)

	m.ApplyDesiredState(desiredState(
		&gatewayv1.TunnelSpec{Id: "tun-a", TargetUrl: "http://localhost:3000", SlugHint: hint},
		&gatewayv1.TunnelSpec{Id: "tun-b", TargetUrl: "http://localhost:4000", SlugHint: hint},
	))
	snapshot := m.TunnelStateSnapshot()
	statusA := findTunnelStatus(snapshot, "tun-a")
	statusB := findTunnelStatus(snapshot, "tun-b")
	if statusA.GetSlug() != hint {
		t.Fatalf("tun-a slug = %q, want hint %q", statusA.GetSlug(), hint)
	}
	if statusB.GetSlug() == hint || statusB.GetSlug() == "" {
		t.Fatalf("tun-b slug should be freshly allocated, got %q", statusB.GetSlug())
	}

	// Invalid hints are ignored.
	m.ApplyDesiredState(desiredState(
		&gatewayv1.TunnelSpec{Id: "tun-c", TargetUrl: "http://localhost:5000", SlugHint: "short"},
	))
	statusC := findTunnelStatus(m.TunnelStateSnapshot(), "tun-c")
	if statusC.GetSlug() == "short" {
		t.Fatal("invalid slug hint must not be honored")
	}
}

func TestApplyDesiredStateEnforcesTunnelCap(t *testing.T) {
	m := newTunnelTestManager(t)
	specs := make([]*gatewayv1.TunnelSpec, 0, maxTunnelsPerAgent+2)
	for i := 0; i < maxTunnelsPerAgent+2; i++ {
		specs = append(specs, &gatewayv1.TunnelSpec{
			Id:        "tun-" + string(rune('a'+i)),
			TargetUrl: "http://localhost:3000",
		})
	}
	m.ApplyDesiredState(desiredState(specs...))
	if got := len(m.TunnelStateSnapshot().GetTunnels()); got != maxTunnelsPerAgent {
		t.Fatalf("tunnels = %d, want cap %d", got, maxTunnelsPerAgent)
	}
}

func TestApplyDesiredStateSkipsExpiredAndInvalidSpecs(t *testing.T) {
	m := newTunnelTestManager(t)
	m.ApplyDesiredState(desiredState(
		&gatewayv1.TunnelSpec{Id: "expired", TargetUrl: "http://localhost:3000", ExpiresAt: time.Now().Add(-time.Minute).Unix()},
		&gatewayv1.TunnelSpec{Id: "", TargetUrl: "http://localhost:3000"},
		&gatewayv1.TunnelSpec{Id: "no-target"},
		&gatewayv1.TunnelSpec{Id: "ok", TargetUrl: "http://localhost:3000"},
	))
	snapshot := m.TunnelStateSnapshot()
	if len(snapshot.GetTunnels()) != 1 || findTunnelStatus(snapshot, "ok") == nil {
		t.Fatalf("snapshot = %#v, want only \"ok\"", snapshot.GetTunnels())
	}
}

func TestSnapshotRevisionIsMonotonic(t *testing.T) {
	m := newTunnelTestManager(t)
	first := m.TunnelStateSnapshot().GetRevision()
	second := m.TunnelStateSnapshot().GetRevision()
	if second <= first {
		t.Fatalf("revision not monotonic: %d then %d", first, second)
	}
}

func TestAcquireTunnelLifecycleAndLimits(t *testing.T) {
	m := newTunnelTestManager(t)
	m.ApplyDesiredState(desiredState(
		&gatewayv1.TunnelSpec{Id: "tun-a", TargetUrl: "http://localhost:3000"},
	))
	slug := m.TunnelStateSnapshot().GetTunnels()[0].GetSlug()

	if _, err := m.AcquireTunnel("missing", "s-1"); err != ErrTunnelNotFound {
		t.Fatalf("acquire missing = %v, want ErrTunnelNotFound", err)
	}

	leases := make([]*TunnelStreamLease, 0, maxTunnelConnections)
	for i := 0; i < maxTunnelConnections; i++ {
		lease, err := m.AcquireTunnel(slug, "s-"+string(rune('a'+i)))
		if err != nil {
			t.Fatalf("acquire %d: %v", i, err)
		}
		leases = append(leases, lease)
	}
	if _, err := m.AcquireTunnel(slug, "s-over"); err != ErrTunnelOverLimit {
		t.Fatalf("over-limit acquire = %v, want ErrTunnelOverLimit", err)
	}
	if got := m.TunnelStateSnapshot().GetTunnels()[0].GetActiveConnections(); got != maxTunnelConnections {
		t.Fatalf("active connections = %d, want %d", got, maxTunnelConnections)
	}
	for _, lease := range leases {
		lease.Release()
	}
	if got := m.TunnelStateSnapshot().GetTunnels()[0].GetActiveConnections(); got != 0 {
		t.Fatalf("active connections after release = %d, want 0", got)
	}

	if lease, err := m.AcquireTunnel(slug, "s-again"); err != nil {
		t.Fatalf("re-acquire after release: %v", err)
	} else {
		if lease.TargetURL() != "http://localhost:3000" {
			t.Fatalf("lease target = %q", lease.TargetURL())
		}
		lease.Release()
	}

	m.ClearSession(mustCurrentSession(t, m))
	if _, err := m.AcquireTunnel(slug, "s-offline"); err != ErrAgentOffline {
		t.Fatalf("offline acquire = %v, want ErrAgentOffline", err)
	}
}

func mustCurrentSession(t *testing.T, m *Manager) *AgentSession {
	t.Helper()
	m.registry.mu.RLock()
	defer m.registry.mu.RUnlock()
	if m.registry.session == nil {
		t.Fatal("no current agent session")
	}
	return m.registry.session
}

func TestDispatchTunnelFrameDropsStreamWhenBacklogged(t *testing.T) {
	m := newTunnelTestManager(t)
	m.ApplyDesiredState(desiredState(
		&gatewayv1.TunnelSpec{Id: "tun-a", TargetUrl: "http://localhost:3000"},
	))
	slug := m.TunnelStateSnapshot().GetTunnels()[0].GetSlug()
	lease, err := m.AcquireTunnel(slug, "s-backlog")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer lease.Release()

	for i := 0; i < tunnelStreamChannelDepth+1; i++ {
		m.dispatchTunnelFrame(&gatewayv1.TunnelFrame{
			StreamId: "s-backlog",
			Kind:     gatewayv1.TunnelFrameKind_TUNNEL_FRAME_KIND_HTTP_RESPONSE_BODY,
		})
	}
	select {
	case <-lease.Done():
	case <-time.After(time.Second):
		t.Fatal("backlogged stream was not closed")
	}
}

func TestSweepExpiredTunnelsRemovesRecords(t *testing.T) {
	m := newTunnelTestManager(t)
	m.ApplyDesiredState(desiredState(
		&gatewayv1.TunnelSpec{Id: "short", TargetUrl: "http://localhost:3000", ExpiresAt: time.Now().Add(30 * time.Second).Unix()},
		&gatewayv1.TunnelSpec{Id: "forever", TargetUrl: "http://localhost:4000"},
	))
	if got := len(m.TunnelStateSnapshot().GetTunnels()); got != 2 {
		t.Fatalf("tunnels = %d, want 2", got)
	}
	m.sweepExpiredTunnels(time.Now().Add(2 * time.Minute))
	snapshot := m.TunnelStateSnapshot()
	if len(snapshot.GetTunnels()) != 1 || findTunnelStatus(snapshot, "forever") == nil {
		t.Fatalf("after sweep = %#v, want only \"forever\"", snapshot.GetTunnels())
	}
}

func TestOnAgentSessionClearedClosesStreamsAndMarksOffline(t *testing.T) {
	m := newTunnelTestManager(t)
	m.ApplyDesiredState(desiredState(
		&gatewayv1.TunnelSpec{Id: "tun-a", TargetUrl: "http://localhost:3000"},
	))
	slug := m.TunnelStateSnapshot().GetTunnels()[0].GetSlug()
	lease, err := m.AcquireTunnel(slug, "s-1")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}

	m.ClearSession(mustCurrentSession(t, m))
	select {
	case <-lease.Done():
	case <-time.After(time.Second):
		t.Fatal("stream not closed after agent session cleared")
	}
	snapshot := m.TunnelStateSnapshot()
	if snapshot.GetAgentOnline() {
		t.Fatal("snapshot still reports agent online")
	}
	if len(snapshot.GetTunnels()) != 1 {
		t.Fatalf("specs must survive agent disconnect, got %d", len(snapshot.GetTunnels()))
	}
}

func TestSubscribeTunnelStateReceivesBroadcasts(t *testing.T) {
	m := newTunnelTestManager(t)
	ch, cleanup := m.SubscribeTunnelState()
	defer cleanup()

	m.ApplyDesiredState(desiredState(
		&gatewayv1.TunnelSpec{Id: "tun-a", TargetUrl: "http://localhost:3000"},
	))

	select {
	case snapshot := <-ch:
		if findTunnelStatus(snapshot, "tun-a") == nil {
			t.Fatalf("broadcast snapshot missing tunnel: %#v", snapshot.GetTunnels())
		}
	case <-time.After(time.Second):
		t.Fatal("no tunnel.state broadcast received")
	}
}
