package server

import (
	"errors"
	"strings"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

type websocketProcessRequestPayload struct {
	ProcessID string `json:"process_id"`
	MaxBytes  uint32 `json:"max_bytes"`
}

// handleProcessSnapshot answers from the gateway cache so the panel can show
// the last known state even while the agent is offline.
func (c *websocketConnection) handleProcessSnapshot(req websocketRequest) {
	_ = c.writeResponse(
		req.ID,
		websocketManagedProcessPayload(c.sm.ManagedProcessSnapshotCached(), c.sm.IsOnline()),
	)
}

func (c *websocketConnection) handleProcessStop(req websocketRequest) {
	c.handleProcessRequest(req, "stop")
}

func (c *websocketConnection) handleProcessReadLog(req websocketRequest) {
	c.handleProcessRequest(req, "read_log")
}

func (c *websocketConnection) handleProcessClear(req websocketRequest) {
	c.handleProcessRequest(req, "clear")
}

// handleProcessRequest forwards a panel operation to the agent (the process
// owner) and relays its verdict. State reaches every client through the
// process.state broadcast that the operation triggers on the agent.
func (c *websocketConnection) handleProcessRequest(req websocketRequest, action string) {
	var body websocketProcessRequestPayload
	if err := decodeWebSocketPayload(req.Payload, &body); err != nil {
		_ = c.writeError(req.ID, "invalid process."+action+" payload")
		return
	}
	processID := strings.TrimSpace(body.ProcessID)
	if processID == "" && action != "clear" {
		_ = c.writeError(req.ID, "process_id is required")
		return
	}

	response, err := c.awaitAgentResponse(req.ID, &gatewayv1.GatewayEnvelope{
		RequestId: req.ID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_ManagedProcessRequest{
			ManagedProcessRequest: &gatewayv1.ManagedProcessRequest{
				Action:    action,
				ProcessId: processID,
				MaxBytes:  body.MaxBytes,
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
	result := response.GetManagedProcessResponse()
	if result == nil {
		_ = c.writeError(req.ID, "unexpected agent response")
		return
	}

	payload := map[string]any{"action": result.GetAction()}
	switch action {
	case "stop":
		payload["stopped"] = result.GetStopped()
		payload["state"] = websocketManagedProcessPayload(result.GetSnapshot(), c.sm.IsOnline())
	case "clear":
		payload["state"] = websocketManagedProcessPayload(result.GetSnapshot(), c.sm.IsOnline())
	case "read_log":
		payload["log_content"] = result.GetLogContent()
		payload["log_path"] = result.GetLogPath()
		payload["log_truncated"] = result.GetLogTruncated()
	}
	_ = c.writeResponse(req.ID, payload)
}

func (c *websocketConnection) startManagedProcessStateForwarder() {
	if c.managedProcessEvents != nil || c.managedProcessEventsCleanup != nil {
		return
	}

	managedProcessEvents, cleanup := c.sm.SubscribeManagedProcessState()
	c.managedProcessEvents = managedProcessEvents
	c.managedProcessEventsCleanup = cleanup

	go func() {
		for {
			select {
			case <-c.done:
				return
			case snapshot, ok := <-managedProcessEvents:
				if !ok {
					return
				}
				payload := websocketManagedProcessPayload(snapshot, c.sm.IsOnline())
				if err := c.writeEvent("process.state", payload); err != nil {
					if errors.Is(err, errWriteQueueFull) {
						continue
					}
					return
				}
			}
		}
	}()
}

func (c *websocketConnection) replayManagedProcessSnapshot() {
	_ = c.writeEvent(
		"process.state",
		websocketManagedProcessPayload(c.sm.ManagedProcessSnapshotCached(), c.sm.IsOnline()),
	)
}

func websocketManagedProcessPayload(
	snapshot *gatewayv1.ManagedProcessSnapshot,
	agentOnline bool,
) map[string]any {
	processes := []map[string]any{}
	revision := uint64(0)
	if snapshot != nil {
		revision = snapshot.GetRevision()
		for _, record := range snapshot.GetProcesses() {
			if record == nil {
				continue
			}
			entry := map[string]any{
				"id":         record.GetId(),
				"label":      record.GetLabel(),
				"command":    record.GetCommand(),
				"cwd":        record.GetCwd(),
				"shell":      record.GetShell(),
				"pid":        record.GetPid(),
				"log_path":   record.GetLogPath(),
				"started_at": record.GetStartedAt(),
				"running":    record.GetRunning(),
				"isolated":   record.GetIsolated(),
				"restored":   record.GetRestored(),
			}
			if record.FinishedAt != nil {
				entry["finished_at"] = record.GetFinishedAt()
			}
			if record.ExitCode != nil {
				entry["exit_code"] = record.GetExitCode()
			}
			processes = append(processes, entry)
		}
	}
	return map[string]any{
		"revision":     revision,
		"agent_online": agentOnline,
		"processes":    processes,
	}
}
