package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

const (
	maxTunnelsPerAgent       = 5
	maxTunnelConnections     = 20
	tunnelSlugEntropyBytes   = 24
	tunnelStreamChannelDepth = 256
	tunnelAgentSendTimeout   = 10 * time.Second
	tunnelRelayProbeTimeout  = 5 * time.Second
	tunnelExpirySweepPeriod  = 30 * time.Second
)

var tunnelSlugPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{22,64}$`)

// tunnelRuntime is the gateway-side runtime view of the agent's desired
// tunnel set: slug allocation, live streams, connection counts, and health.
// The desired specs themselves are owned and persisted by the agent.
type tunnelRuntime struct {
	mu       sync.Mutex
	records  map[string]*tunnelRecord
	slugToID map[string]string
	streams  map[string]*tunnelStream
	revision uint64
	relay    *gatewayv1.TunnelHealth

	subMu       sync.Mutex
	nextSubID   int
	subscribers map[int]chan *gatewayv1.TunnelStateSnapshot

	pingMu       sync.Mutex
	pendingPings map[string]chan int64
}

type tunnelRecord struct {
	id                string
	slug              string
	name              string
	targetURL         string
	projectPathKey    string
	createdAt         time.Time
	expiresAt         time.Time
	activeConnections int
	local             *gatewayv1.TunnelHealth
}

type tunnelStream struct {
	streamID string
	tunnelID string
	ch       chan *gatewayv1.TunnelFrame
	done     chan struct{}
	once     sync.Once
}

// TunnelStreamLease is one visitor connection's claim on a tunnel.
type TunnelStreamLease struct {
	manager   *Manager
	stream    *tunnelStream
	slug      string
	targetURL string
	once      sync.Once
}

func newTunnelRuntime() *tunnelRuntime {
	return &tunnelRuntime{
		records:      make(map[string]*tunnelRecord),
		slugToID:     make(map[string]string),
		streams:      make(map[string]*tunnelStream),
		subscribers:  make(map[int]chan *gatewayv1.TunnelStateSnapshot),
		pendingPings: make(map[string]chan int64),
	}
}

func (s *tunnelStream) close() {
	if s == nil {
		return
	}
	s.once.Do(func() {
		close(s.done)
	})
}

func (l *TunnelStreamLease) TunnelID() string {
	if l == nil || l.stream == nil {
		return ""
	}
	return l.stream.tunnelID
}

func (l *TunnelStreamLease) Slug() string {
	if l == nil {
		return ""
	}
	return l.slug
}

func (l *TunnelStreamLease) TargetURL() string {
	if l == nil {
		return ""
	}
	return l.targetURL
}

func (l *TunnelStreamLease) StreamID() string {
	if l == nil || l.stream == nil {
		return ""
	}
	return l.stream.streamID
}

func (l *TunnelStreamLease) Frames() <-chan *gatewayv1.TunnelFrame {
	if l == nil || l.stream == nil {
		return nil
	}
	return l.stream.ch
}

func (l *TunnelStreamLease) Done() <-chan struct{} {
	if l == nil || l.stream == nil {
		return nil
	}
	return l.stream.done
}

func (l *TunnelStreamLease) Release() {
	if l == nil {
		return
	}
	l.once.Do(func() {
		l.manager.releaseTunnelStream(l.stream)
	})
}

func (m *Manager) WebTunnelsEnabled() bool {
	m.syncHub.settingsSnapshotMu.RLock()
	defer m.syncHub.settingsSnapshotMu.RUnlock()

	remote, ok := m.syncHub.settingsSnapshot["remote"].(map[string]any)
	if !ok {
		return false
	}
	enabled, ok := remote["enableWebTunnels"].(bool)
	return ok && enabled
}

// ApplyDesiredState reconciles the runtime against the agent's full desired
// tunnel set: allocates slugs for new tunnels (honoring valid unused hints),
// updates changed ones, and drops removed ones (canceling their streams).
func (m *Manager) ApplyDesiredState(desired *gatewayv1.TunnelDesiredState) {
	if desired == nil {
		return
	}
	now := time.Now()
	specs := desired.GetTunnels()
	if len(specs) > maxTunnelsPerAgent {
		specs = specs[:maxTunnelsPerAgent]
	}

	var canceled []*tunnelStream
	m.tunnels.mu.Lock()
	seen := make(map[string]bool, len(specs))
	for _, spec := range specs {
		id := strings.TrimSpace(spec.GetId())
		targetURL := strings.TrimSpace(spec.GetTargetUrl())
		if id == "" || targetURL == "" || seen[id] {
			continue
		}
		expiresAt := time.Time{}
		if spec.GetExpiresAt() > 0 {
			expiresAt = time.Unix(spec.GetExpiresAt(), 0)
			if !expiresAt.After(now) {
				continue
			}
		}
		seen[id] = true
		record := m.tunnels.records[id]
		if record == nil {
			record = &tunnelRecord{
				id:        id,
				slug:      m.allocateTunnelSlugLocked(spec.GetSlugHint()),
				createdAt: now,
			}
			m.tunnels.records[id] = record
			m.tunnels.slugToID[record.slug] = id
		}
		record.name = strings.TrimSpace(spec.GetName())
		record.targetURL = targetURL
		record.projectPathKey = strings.TrimSpace(spec.GetProjectPathKey())
		record.expiresAt = expiresAt
	}
	for id, record := range m.tunnels.records {
		if seen[id] {
			continue
		}
		canceled = append(canceled, m.dropTunnelRecordLocked(record)...)
	}
	m.tunnels.mu.Unlock()

	m.cancelTunnelStreams(canceled)
	m.broadcastTunnelState()
	go m.probeRelay()
}

// ApplyProbeReport merges agent-reported local-service health into the runtime.
func (m *Manager) ApplyProbeReport(report *gatewayv1.TunnelProbeReport) {
	if report == nil || len(report.GetResults()) == 0 {
		return
	}
	changed := false
	m.tunnels.mu.Lock()
	for _, result := range report.GetResults() {
		record := m.tunnels.records[strings.TrimSpace(result.GetTunnelId())]
		if record == nil || result.GetLocal() == nil {
			continue
		}
		record.local = cloneTunnelHealth(result.GetLocal())
		changed = true
	}
	m.tunnels.mu.Unlock()
	if changed {
		m.broadcastTunnelState()
	}
}

// dropTunnelRecordLocked removes a record and returns its now-closed streams
// so CANCEL frames can be sent to the agent outside the lock.
func (m *Manager) dropTunnelRecordLocked(record *tunnelRecord) []*tunnelStream {
	if record == nil {
		return nil
	}
	delete(m.tunnels.records, record.id)
	delete(m.tunnels.slugToID, record.slug)
	var dropped []*tunnelStream
	for streamID, stream := range m.tunnels.streams {
		if stream == nil || stream.tunnelID != record.id {
			continue
		}
		delete(m.tunnels.streams, streamID)
		stream.close()
		dropped = append(dropped, stream)
	}
	return dropped
}

func (m *Manager) cancelTunnelStreams(streams []*tunnelStream) {
	for _, stream := range streams {
		_ = m.SendTunnelFrameToAgent(&gatewayv1.TunnelFrame{
			StreamId: stream.streamID,
			Kind:     gatewayv1.TunnelFrameKind_TUNNEL_FRAME_KIND_CANCEL,
		})
	}
}

func (m *Manager) allocateTunnelSlugLocked(hint string) string {
	hint = strings.TrimSpace(hint)
	if tunnelSlugPattern.MatchString(hint) {
		if _, taken := m.tunnels.slugToID[hint]; !taken {
			return hint
		}
	}
	for {
		slug := randomURLToken(tunnelSlugEntropyBytes)
		if slug == "" {
			// crypto/rand failure; fall back to a UUID-derived token.
			slug = strings.ReplaceAll(uuid.NewString(), "-", "")
		}
		if _, taken := m.tunnels.slugToID[slug]; !taken {
			return slug
		}
	}
}

func randomURLToken(byteCount int) string {
	if byteCount <= 0 {
		return ""
	}
	buf := make([]byte, byteCount)
	if _, err := rand.Read(buf); err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// TunnelStateSnapshot builds the authoritative state pushed to every client.
func (m *Manager) TunnelStateSnapshot() *gatewayv1.TunnelStateSnapshot {
	online := m.IsOnline()
	m.tunnels.mu.Lock()
	defer m.tunnels.mu.Unlock()
	return m.tunnelStateSnapshotLocked(online)
}

func (m *Manager) tunnelStateSnapshotLocked(online bool) *gatewayv1.TunnelStateSnapshot {
	tunnels := make([]*gatewayv1.TunnelStatus, 0, len(m.tunnels.records))
	for _, record := range m.tunnels.records {
		tunnels = append(tunnels, &gatewayv1.TunnelStatus{
			Id:                record.id,
			Slug:              record.slug,
			Name:              record.name,
			TargetUrl:         record.targetURL,
			PublicPath:        "/t/" + record.slug + "/",
			CreatedAt:         record.createdAt.Unix(),
			ExpiresAt:         unixOrZero(record.expiresAt),
			ActiveConnections: uint32(max(record.activeConnections, 0)),
			ProjectPathKey:    record.projectPathKey,
			Local:             cloneTunnelHealth(record.local),
		})
	}
	sort.Slice(tunnels, func(i, j int) bool {
		if tunnels[i].GetCreatedAt() != tunnels[j].GetCreatedAt() {
			return tunnels[i].GetCreatedAt() < tunnels[j].GetCreatedAt()
		}
		return tunnels[i].GetId() < tunnels[j].GetId()
	})
	m.tunnels.revision += 1
	return &gatewayv1.TunnelStateSnapshot{
		Tunnels:     tunnels,
		Revision:    m.tunnels.revision,
		AgentOnline: online,
		Relay:       cloneTunnelHealth(m.tunnels.relay),
	}
}

func (m *Manager) SubscribeTunnelState() (<-chan *gatewayv1.TunnelStateSnapshot, func()) {
	ch := make(chan *gatewayv1.TunnelStateSnapshot, 16)

	m.tunnels.subMu.Lock()
	subID := m.tunnels.nextSubID
	m.tunnels.nextSubID += 1
	m.tunnels.subscribers[subID] = ch
	m.tunnels.subMu.Unlock()

	cleanup := func() {
		m.tunnels.subMu.Lock()
		// Do not close the channel: broadcastTunnelState sends after copying
		// subscribers, so closing can race with an in-flight send.
		delete(m.tunnels.subscribers, subID)
		m.tunnels.subMu.Unlock()
	}
	return ch, cleanup
}

// broadcastTunnelState pushes the current snapshot to /ws subscribers and to
// the agent (which persists allocated slugs and re-emits it to the GUI).
func (m *Manager) broadcastTunnelState() {
	snapshot := m.TunnelStateSnapshot()

	m.tunnels.subMu.Lock()
	subscribers := make([]chan *gatewayv1.TunnelStateSnapshot, 0, len(m.tunnels.subscribers))
	for _, ch := range m.tunnels.subscribers {
		subscribers = append(subscribers, ch)
	}
	m.tunnels.subMu.Unlock()

	for _, ch := range subscribers {
		select {
		case ch <- snapshot:
		default:
		}
	}

	// Best-effort, non-blocking: the agent only mines snapshots for allocated
	// slugs and UI display, and a fresher snapshot follows every state change.
	m.registry.mu.RLock()
	session := m.registry.session
	m.registry.mu.RUnlock()
	if session != nil {
		_, _ = session.TrySendToAgent(&gatewayv1.GatewayEnvelope{
			RequestId: "tunnel-state-" + uuid.NewString(),
			Timestamp: time.Now().Unix(),
			Payload: &gatewayv1.GatewayEnvelope_TunnelState{
				TunnelState: snapshot,
			},
		})
	}
}

// AcquireTunnel claims a visitor stream slot on the tunnel behind slug.
func (m *Manager) AcquireTunnel(slug string, streamID string) (*TunnelStreamLease, error) {
	slug = strings.TrimSpace(slug)
	streamID = strings.TrimSpace(streamID)
	if slug == "" || streamID == "" {
		return nil, ErrTunnelNotFound
	}
	if !m.IsOnline() {
		return nil, ErrAgentOffline
	}
	now := time.Now()

	m.tunnels.mu.Lock()
	defer m.tunnels.mu.Unlock()

	record := m.tunnels.records[m.tunnels.slugToID[slug]]
	if record == nil {
		return nil, ErrTunnelNotFound
	}
	if !record.expiresAt.IsZero() && !record.expiresAt.After(now) {
		return nil, ErrTunnelExpired
	}
	if record.activeConnections >= maxTunnelConnections {
		return nil, ErrTunnelOverLimit
	}
	stream := &tunnelStream{
		streamID: streamID,
		tunnelID: record.id,
		ch:       make(chan *gatewayv1.TunnelFrame, tunnelStreamChannelDepth),
		done:     make(chan struct{}),
	}
	if existing := m.tunnels.streams[streamID]; existing != nil {
		existing.close()
	}
	m.tunnels.streams[streamID] = stream
	record.activeConnections += 1

	return &TunnelStreamLease{
		manager:   m,
		stream:    stream,
		slug:      record.slug,
		targetURL: record.targetURL,
	}, nil
}

func (m *Manager) releaseTunnelStream(stream *tunnelStream) {
	if stream == nil {
		return
	}
	m.tunnels.mu.Lock()
	if existing := m.tunnels.streams[stream.streamID]; existing == stream {
		delete(m.tunnels.streams, stream.streamID)
	}
	if record := m.tunnels.records[stream.tunnelID]; record != nil && record.activeConnections > 0 {
		record.activeConnections -= 1
	}
	stream.close()
	m.tunnels.mu.Unlock()
}

func (m *Manager) SendTunnelFrameToAgent(frame *gatewayv1.TunnelFrame) error {
	if frame == nil {
		return fmt.Errorf("tunnel frame is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), tunnelAgentSendTimeout)
	defer cancel()
	return m.SendToAgentContext(ctx, &gatewayv1.GatewayEnvelope{
		RequestId: "tunnel-frame-" + uuid.NewString(),
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_TunnelFrame{
			TunnelFrame: frame,
		},
	})
}

// dispatchTunnelFrame routes an agent frame to its visitor stream. It runs on
// the agent gRPC read loop, so it must never block: a full stream channel
// closes the stream (the visitor handler cancels) instead of waiting.
func (m *Manager) dispatchTunnelFrame(frame *gatewayv1.TunnelFrame) {
	if frame == nil {
		return
	}
	if frame.GetKind() == gatewayv1.TunnelFrameKind_TUNNEL_FRAME_KIND_PONG {
		m.resolveRelayPong(frame.GetStreamId())
		return
	}
	streamID := strings.TrimSpace(frame.GetStreamId())
	if streamID == "" {
		return
	}
	m.tunnels.mu.Lock()
	stream := m.tunnels.streams[streamID]
	m.tunnels.mu.Unlock()
	if stream == nil {
		return
	}
	select {
	case <-stream.done:
	case stream.ch <- frame:
	default:
		m.releaseTunnelStream(stream)
		go func() {
			_ = m.SendTunnelFrameToAgent(&gatewayv1.TunnelFrame{
				StreamId: streamID,
				Kind:     gatewayv1.TunnelFrameKind_TUNNEL_FRAME_KIND_CANCEL,
				Error:    "tunnel stream backlog exceeded",
			})
		}()
	}
}

// probeRelay measures the gateway<->agent frame path with a PING/PONG round
// trip and folds the result into the broadcast snapshot.
func (m *Manager) probeRelay() {
	checkedAt := time.Now()
	health := &gatewayv1.TunnelHealth{Status: "failed", CheckedAt: checkedAt.Unix()}

	if !m.IsOnline() {
		health.Error = "agent offline"
		m.setRelayHealth(health)
		return
	}

	pingID := "ping-" + uuid.NewString()
	pongCh := make(chan int64, 1)
	m.tunnels.pingMu.Lock()
	m.tunnels.pendingPings[pingID] = pongCh
	m.tunnels.pingMu.Unlock()
	defer func() {
		m.tunnels.pingMu.Lock()
		delete(m.tunnels.pendingPings, pingID)
		m.tunnels.pingMu.Unlock()
	}()

	if err := m.SendTunnelFrameToAgent(&gatewayv1.TunnelFrame{
		StreamId: pingID,
		Kind:     gatewayv1.TunnelFrameKind_TUNNEL_FRAME_KIND_PING,
	}); err != nil {
		health.Error = err.Error()
		m.setRelayHealth(health)
		return
	}

	timer := time.NewTimer(tunnelRelayProbeTimeout)
	defer timer.Stop()
	select {
	case <-pongCh:
		health.Status = "ok"
		health.RttMs = uint32(min(time.Since(checkedAt).Milliseconds(), int64(^uint32(0))))
	case <-timer.C:
		health.Error = "relay probe timed out"
	}
	m.setRelayHealth(health)
}

func (m *Manager) resolveRelayPong(streamID string) {
	m.tunnels.pingMu.Lock()
	ch := m.tunnels.pendingPings[strings.TrimSpace(streamID)]
	delete(m.tunnels.pendingPings, strings.TrimSpace(streamID))
	m.tunnels.pingMu.Unlock()
	if ch != nil {
		select {
		case ch <- time.Now().UnixMilli():
		default:
		}
	}
}

func (m *Manager) setRelayHealth(health *gatewayv1.TunnelHealth) {
	m.tunnels.mu.Lock()
	m.tunnels.relay = health
	m.tunnels.mu.Unlock()
	m.broadcastTunnelState()
}

// onAgentSessionCleared drops live visitor streams (their frames can no longer
// be relayed) and pushes an offline snapshot; the specs stay so `/t/*` answers
// 503 instead of 404 and clients keep rendering the tunnels as offline.
func (m *Manager) onAgentSessionCleared() {
	m.tunnels.mu.Lock()
	for streamID, stream := range m.tunnels.streams {
		delete(m.tunnels.streams, streamID)
		stream.close()
	}
	m.tunnels.relay = nil
	m.tunnels.mu.Unlock()
	m.broadcastTunnelState()
	// Managed-process subscribers re-render with agent_online=false.
	m.rebroadcastManagedProcessState()
	// /ws clients learn the agent went offline by push, not by poll.
	m.broadcastStatus()
}

func (m *Manager) tunnelExpirySweepLoop() {
	ticker := time.NewTicker(tunnelExpirySweepPeriod)
	defer ticker.Stop()
	for range ticker.C {
		m.sweepExpiredTunnels(time.Now())
	}
}

func (m *Manager) sweepExpiredTunnels(now time.Time) {
	var canceled []*tunnelStream
	removed := false
	m.tunnels.mu.Lock()
	for _, record := range m.tunnels.records {
		if record.expiresAt.IsZero() || record.expiresAt.After(now) {
			continue
		}
		canceled = append(canceled, m.dropTunnelRecordLocked(record)...)
		removed = true
	}
	m.tunnels.mu.Unlock()

	if !removed {
		return
	}
	m.cancelTunnelStreams(canceled)
	m.broadcastTunnelState()
}

func cloneTunnelHealth(health *gatewayv1.TunnelHealth) *gatewayv1.TunnelHealth {
	if health == nil {
		return nil
	}
	return &gatewayv1.TunnelHealth{
		Status:     health.GetStatus(),
		HttpStatus: health.GetHttpStatus(),
		Error:      health.GetError(),
		CheckedAt:  health.GetCheckedAt(),
		RttMs:      health.GetRttMs(),
	}
}

func unixOrZero(value time.Time) int64 {
	if value.IsZero() {
		return 0
	}
	return value.Unix()
}
