package server

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/liveagent/agent-gateway/internal/auth"
	"github.com/liveagent/agent-gateway/internal/config"
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/session"
)

const (
	terminalStreamFrameVersion = byte(1)
	terminalStreamWriteQueue   = 1024
)

var terminalStreamKindByte = map[string]byte{
	"attach":   1,
	"input":    2,
	"resize":   3,
	"detach":   4,
	"output":   5,
	"snapshot": 6,
	"error":    7,
}

type terminalStreamAuthPayload struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

type terminalStreamFrameHeader struct {
	Kind           string         `json:"kind,omitempty"`
	StreamID       string         `json:"streamId,omitempty"`
	SessionID      string         `json:"sessionId,omitempty"`
	ProjectPathKey string         `json:"projectPathKey,omitempty"`
	Seq            uint64         `json:"seq,omitempty"`
	StartOffset    uint64         `json:"startOffset,omitempty"`
	EndOffset      uint64         `json:"endOffset,omitempty"`
	Cols           uint32         `json:"cols,omitempty"`
	Rows           uint32         `json:"rows,omitempty"`
	MaxBytes       uint32         `json:"maxBytes,omitempty"`
	Truncated      bool           `json:"truncated,omitempty"`
	Error          string         `json:"error,omitempty"`
	Session        map[string]any `json:"session,omitempty"`
}

type terminalStreamWSConnection struct {
	cfg *config.Config
	sm  *session.Manager

	conn *websocket.Conn
	out  chan []byte
	done chan struct{}
	once sync.Once

	mu       sync.RWMutex
	attached map[string]struct{}
	streams  map[string]struct{}
}

func NewTerminalWebSocketServer(cfg *config.Config, sm *session.Manager) http.Handler {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return originAllowed(r)
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		conn.SetReadLimit(webSocketReadLimit(cfg))

		state := &terminalStreamWSConnection{
			cfg:      cfg,
			sm:       sm,
			conn:     conn,
			out:      make(chan []byte, terminalStreamWriteQueue),
			done:     make(chan struct{}),
			attached: make(map[string]struct{}),
			streams:  make(map[string]struct{}),
		}
		defer state.close()
		state.serve()
	})
}

func (c *terminalStreamWSConnection) serve() {
	if !c.authenticate() {
		return
	}

	go c.writeLoop()
	c.startForwarder()

	for {
		messageType, payload, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.BinaryMessage {
			continue
		}
		frame, err := decodeTerminalStreamFrame(payload)
		if err != nil {
			c.enqueueFrame(terminalStreamErrorFrame("", "", "", err.Error()))
			continue
		}
		c.handleFrame(frame)
	}
}

func (c *terminalStreamWSConnection) authenticate() bool {
	messageType, payload, err := c.conn.ReadMessage()
	if err != nil || messageType != websocket.TextMessage {
		return false
	}
	var authPayload terminalStreamAuthPayload
	if err := json.Unmarshal(payload, &authPayload); err != nil {
		return false
	}
	if strings.TrimSpace(authPayload.Type) != "auth" {
		return false
	}
	if !auth.ValidateToken(authPayload.Token, c.cfg.Token) {
		_ = c.conn.WriteJSON(map[string]any{"type": "error", "error": "unauthorized"})
		return false
	}
	_ = c.conn.WriteJSON(map[string]any{"type": "ready"})
	return true
}

func (c *terminalStreamWSConnection) handleFrame(frame *gatewayv1.TerminalStreamFrame) {
	kind := strings.TrimSpace(frame.GetKind())
	if !c.frameAllowed(frame) {
		c.enqueueFrame(terminalStreamErrorFrame(
			frame.GetStreamId(),
			frame.GetSessionId(),
			frame.GetProjectPathKey(),
			terminalPermissionError(kind),
		))
		return
	}

	switch kind {
	case "attach":
		c.remember(frame.GetSessionId(), frame.GetStreamId())
	case "detach":
		c.forget(frame.GetSessionId(), frame.GetStreamId())
	case "input", "resize":
		if !c.isAttached(frame.GetSessionId()) {
			c.enqueueFrame(terminalStreamErrorFrame(
				frame.GetStreamId(),
				frame.GetSessionId(),
				frame.GetProjectPathKey(),
				"terminal stream is not attached",
			))
			return
		}
	default:
		c.enqueueFrame(terminalStreamErrorFrame(
			frame.GetStreamId(),
			frame.GetSessionId(),
			frame.GetProjectPathKey(),
			"unsupported terminal stream frame",
		))
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.sm.SendTerminalFrameToAgent(ctx, frame); err != nil {
		message := "desktop agent is offline"
		if !errors.Is(err, session.ErrAgentOffline) {
			message = err.Error()
		}
		c.enqueueFrame(terminalStreamErrorFrame(
			frame.GetStreamId(),
			frame.GetSessionId(),
			frame.GetProjectPathKey(),
			message,
		))
	}
}

func (c *terminalStreamWSConnection) frameAllowed(frame *gatewayv1.TerminalStreamFrame) bool {
	if frame == nil {
		return false
	}
	sessionID := strings.TrimSpace(frame.GetSessionId())
	switch c.sm.TerminalSessionKind(sessionID) {
	case "ssh":
		return c.sm.WebSshTerminalEnabled()
	case "local":
		return c.sm.WebTerminalEnabled()
	default:
		return c.sm.WebTerminalEnabled() || c.sm.WebSshTerminalEnabled()
	}
}

func (c *terminalStreamWSConnection) startForwarder() {
	frames, cleanup := c.sm.SubscribeTerminalStreamFrames()
	go func() {
		defer cleanup()
		for {
			select {
			case <-c.done:
				return
			case frame, ok := <-frames:
				if !ok {
					c.close()
					return
				}
				if !c.shouldForward(frame) {
					continue
				}
				c.enqueueFrame(frame)
			}
		}
	}()
}

func (c *terminalStreamWSConnection) shouldForward(frame *gatewayv1.TerminalStreamFrame) bool {
	if frame == nil {
		return false
	}
	kind := strings.TrimSpace(frame.GetKind())
	if kind == "snapshot" || kind == "error" {
		return c.knowsStream(frame.GetStreamId())
	}
	if kind != "output" {
		return false
	}
	return c.isAttached(frame.GetSessionId())
}

func (c *terminalStreamWSConnection) remember(sessionID string, streamID string) {
	sessionID = strings.TrimSpace(sessionID)
	streamID = strings.TrimSpace(streamID)
	if sessionID == "" && streamID == "" {
		return
	}
	c.mu.Lock()
	if sessionID != "" {
		c.attached[sessionID] = struct{}{}
	}
	if streamID != "" {
		c.streams[streamID] = struct{}{}
	}
	c.mu.Unlock()
}

func (c *terminalStreamWSConnection) forget(sessionID string, streamID string) {
	sessionID = strings.TrimSpace(sessionID)
	streamID = strings.TrimSpace(streamID)
	if sessionID == "" && streamID == "" {
		return
	}
	c.mu.Lock()
	if sessionID != "" {
		delete(c.attached, sessionID)
	}
	if streamID != "" {
		delete(c.streams, streamID)
	}
	c.mu.Unlock()
}

func (c *terminalStreamWSConnection) isAttached(sessionID string) bool {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return false
	}
	c.mu.RLock()
	_, ok := c.attached[sessionID]
	c.mu.RUnlock()
	return ok
}

func (c *terminalStreamWSConnection) knowsStream(streamID string) bool {
	streamID = strings.TrimSpace(streamID)
	if streamID == "" {
		return false
	}
	c.mu.RLock()
	_, ok := c.streams[streamID]
	c.mu.RUnlock()
	return ok
}

func (c *terminalStreamWSConnection) enqueueFrame(frame *gatewayv1.TerminalStreamFrame) {
	payload, err := encodeTerminalStreamFrame(frame)
	if err != nil {
		return
	}
	select {
	case <-c.done:
	case c.out <- payload:
	default:
		c.close()
	}
}

func (c *terminalStreamWSConnection) writeLoop() {
	for {
		select {
		case <-c.done:
			return
		case payload := <-c.out:
			if c.cfg != nil && c.cfg.WebSocketWriteTimeout > 0 {
				_ = c.conn.SetWriteDeadline(time.Now().Add(c.cfg.WebSocketWriteTimeout))
			}
			if err := c.conn.WriteMessage(websocket.BinaryMessage, payload); err != nil {
				c.close()
				return
			}
			_ = c.conn.SetWriteDeadline(time.Time{})
		}
	}
}

func (c *terminalStreamWSConnection) close() {
	c.once.Do(func() {
		close(c.done)
		_ = c.conn.Close()
	})
}

func decodeTerminalStreamFrame(payload []byte) (*gatewayv1.TerminalStreamFrame, error) {
	if len(payload) < 4 {
		return nil, errors.New("terminal frame is too short")
	}
	if payload[0] != terminalStreamFrameVersion {
		return nil, errors.New("unsupported terminal frame version")
	}
	headerLen := int(binary.BigEndian.Uint16(payload[2:4]))
	if len(payload) < 4+headerLen {
		return nil, errors.New("terminal frame header is truncated")
	}
	var header terminalStreamFrameHeader
	if err := json.Unmarshal(payload[4:4+headerLen], &header); err != nil {
		return nil, errors.New("terminal frame header is invalid")
	}
	data := append([]byte(nil), payload[4+headerLen:]...)
	return &gatewayv1.TerminalStreamFrame{
		Kind:           strings.TrimSpace(header.Kind),
		StreamId:       strings.TrimSpace(header.StreamID),
		SessionId:      strings.TrimSpace(header.SessionID),
		ProjectPathKey: strings.TrimSpace(header.ProjectPathKey),
		Seq:            header.Seq,
		StartOffset:    header.StartOffset,
		EndOffset:      header.EndOffset,
		Cols:           header.Cols,
		Rows:           header.Rows,
		MaxBytes:       header.MaxBytes,
		Truncated:      header.Truncated,
		Error:          strings.TrimSpace(header.Error),
		Data:           data,
	}, nil
}

func encodeTerminalStreamFrame(frame *gatewayv1.TerminalStreamFrame) ([]byte, error) {
	if frame == nil {
		return nil, errors.New("terminal frame is nil")
	}
	kind := strings.TrimSpace(frame.GetKind())
	header := terminalStreamFrameHeader{
		Kind:           kind,
		StreamID:       strings.TrimSpace(frame.GetStreamId()),
		SessionID:      strings.TrimSpace(frame.GetSessionId()),
		ProjectPathKey: strings.TrimSpace(frame.GetProjectPathKey()),
		Seq:            frame.GetSeq(),
		StartOffset:    frame.GetStartOffset(),
		EndOffset:      frame.GetEndOffset(),
		Cols:           frame.GetCols(),
		Rows:           frame.GetRows(),
		MaxBytes:       frame.GetMaxBytes(),
		Truncated:      frame.GetTruncated(),
		Error:          strings.TrimSpace(frame.GetError()),
	}
	if session := websocketTerminalSessionPayload(frame.GetSession()); session != nil {
		header.Session = session
	}
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return nil, err
	}
	if len(headerBytes) > 0xffff {
		return nil, errors.New("terminal frame header is too large")
	}
	data := frame.GetData()
	payload := make([]byte, 4+len(headerBytes)+len(data))
	payload[0] = terminalStreamFrameVersion
	payload[1] = terminalStreamKindByte[kind]
	binary.BigEndian.PutUint16(payload[2:4], uint16(len(headerBytes)))
	copy(payload[4:], headerBytes)
	copy(payload[4+len(headerBytes):], data)
	return payload, nil
}

func terminalStreamErrorFrame(streamID, sessionID, projectPathKey, message string) *gatewayv1.TerminalStreamFrame {
	return &gatewayv1.TerminalStreamFrame{
		Kind:           "error",
		StreamId:       strings.TrimSpace(streamID),
		SessionId:      strings.TrimSpace(sessionID),
		ProjectPathKey: strings.TrimSpace(projectPathKey),
		Error:          strings.TrimSpace(message),
	}
}
