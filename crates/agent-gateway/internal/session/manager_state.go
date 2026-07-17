package session

import (
	"sync"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

type sessionRegistry struct {
	mu           sync.RWMutex
	session      *AgentSession
	sessionEpoch uint64
	lastAuth     AuthSnapshot
	authValid    bool

	runtimeState          string
	runtimeWorkerID       string
	runtimeLastHeartbeat  time.Time
	runtimeVisible        bool
	runtimeActiveRunCount uint32
	chatRuntimeProbeAt    time.Time
}

func newSessionRegistry() *sessionRegistry {
	return &sessionRegistry{}
}

type syncHub struct {
	historyMu          sync.Mutex
	nextHistorySubID   int
	historySubscribers map[int]chan *gatewayv1.HistorySyncEvent

	settingsMu          sync.Mutex
	nextSettingsSubID   int
	settingsSubscribers map[int]chan *gatewayv1.SettingsSyncEvent
	settingsSnapshotMu  sync.RWMutex
	settingsSnapshot    map[string]any

	terminalMu          sync.Mutex
	nextTerminalSubID   int
	terminalSubscribers map[int]chan *gatewayv1.TerminalEvent
	terminalSessions    map[string]*gatewayv1.TerminalSession

	terminalStreamMu          sync.Mutex
	nextTerminalStreamSubID   int
	terminalStreamSubscribers map[int]chan *gatewayv1.TerminalStreamFrame
	terminalStreamToAgent     chan *gatewayv1.TerminalStreamFrame

	sftpMu          sync.Mutex
	nextSftpSubID   int
	sftpSubscribers map[int]chan *gatewayv1.SftpEvent

	chatQueueMu          sync.Mutex
	nextChatQueueSubID   int
	chatQueueSubscribers map[int]chan *gatewayv1.ChatQueueEvent
	chatQueueSnapshots   map[string]chatQueueSnapshotRecord
}

func newSyncHub() *syncHub {
	return &syncHub{
		historySubscribers:        make(map[int]chan *gatewayv1.HistorySyncEvent),
		settingsSubscribers:       make(map[int]chan *gatewayv1.SettingsSyncEvent),
		terminalSubscribers:       make(map[int]chan *gatewayv1.TerminalEvent),
		terminalSessions:          make(map[string]*gatewayv1.TerminalSession),
		terminalStreamSubscribers: make(map[int]chan *gatewayv1.TerminalStreamFrame),
		sftpSubscribers:           make(map[int]chan *gatewayv1.SftpEvent),
		chatQueueSubscribers:      make(map[int]chan *gatewayv1.ChatQueueEvent),
		chatQueueSnapshots:        make(map[string]chatQueueSnapshotRecord),
	}
}
