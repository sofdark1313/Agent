package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/liveagent/agent-gateway/internal/config"
	"github.com/liveagent/agent-gateway/internal/handler"
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/session"
)

type chatCommandMessageRef struct {
	SegmentIndex int    `json:"segment_index"`
	MessageIndex int    `json:"message_index"`
	SegmentID    string `json:"segment_id"`
	MessageID    string `json:"message_id"`
	Role         string `json:"role"`
	ContentHash  string `json:"content_hash"`
}

const (
	chatRuntimeWakeRequestPrefix = "chat-runtime-wake-"
	chatRuntimeProbeReuseWindow  = 2 * time.Second
)

func newChatTraceID() string {
	return strings.ReplaceAll(uuid.NewString(), "-", "")
}

func logChatCommandSpan(
	traceID string,
	span string,
	runID string,
	conversationID string,
	clientRequestID string,
	commandType string,
) {
	log.Printf(
		"chat_command_span span=%s trace_id=%s run_id=%q conversation_id=%q client_request_id=%q command_type=%q",
		strings.TrimSpace(span),
		strings.TrimSpace(traceID),
		strings.TrimSpace(runID),
		strings.TrimSpace(conversationID),
		strings.TrimSpace(clientRequestID),
		strings.TrimSpace(commandType),
	)
}

func normalizeChatRequestBody(body *handler.ChatRequestBody) error {
	body.Message = strings.TrimSpace(body.Message)
	body.ConversationID = strings.TrimSpace(body.ConversationID)
	body.ClientRequestID = strings.TrimSpace(body.ClientRequestID)
	body.ExecutionMode = handler.NormalizeExecutionMode(body.ExecutionMode)
	body.Workdir = handler.NormalizeWorkdir(body.Workdir)
	body.QueuePolicy = normalizeChatQueuePolicy(body.QueuePolicy)
	body.SelectedSystemTools = handler.NormalizeSelectedSystemTools(body.SelectedSystemTools)
	body.UploadedFiles = handler.NormalizeChatUploadedFiles(body.UploadedFiles)
	body.RuntimeControls = handler.NormalizeChatRuntimeControls(body.RuntimeControls)
	selectedModel, err := handler.NormalizeChatSelectedModel(body.SelectedModel)
	if err != nil {
		return err
	}
	body.SelectedModel = selectedModel
	if body.ClientRequestID == "" {
		return errors.New("client_request_id is required")
	}
	if body.Message == "" && len(body.UploadedFiles) == 0 {
		return errors.New("message is required")
	}
	return nil
}

func normalizeChatQueuePolicy(value string) string {
	switch strings.TrimSpace(value) {
	case "append", "interrupt":
		return strings.TrimSpace(value)
	default:
		return "auto"
	}
}

// dispatchAcceptedChatCommand delivers the accepted command to the agent and
// arms the startup watchdog. cleanupWatch closes the caller's command-update
// watch once the command has either settled or been failed.
func dispatchAcceptedChatCommand(
	parent context.Context,
	cfg *config.Config,
	sm *session.Manager,
	cleanupWatch func(),
	start session.ChatCommandStart,
	body handler.ChatRequestBody,
	baseMessageRef *chatCommandMessageRef,
	traceID string,
) {
	if cleanupWatch != nil {
		defer cleanupWatch()
	}
	timeout := chatDeliveryTimeout(cfg)
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	commandType := "chat.submit"
	if baseMessageRef != nil {
		commandType = "chat.edit_resend"
	}
	if err := sm.SendToAgentContext(ctx, buildChatCommandEnvelope(start.RunID, commandType, body, baseMessageRef)); err != nil {
		message := "chat command failed"
		if err != nil && strings.TrimSpace(err.Error()) != "" {
			message = strings.TrimSpace(err.Error())
		}
		sm.FailChatCommand(start.RunID, "desktop_runtime_unavailable", message)
		return
	}
	logChatCommandSpan(traceID, "command_delivered", start.RunID, start.ConversationID, body.ClientRequestID, commandType)
	watchAcceptedChatCommandStartup(parent, cfg, sm, start.RunID)
}

// probeChatRuntime verifies that the current desktop AgentConnect stream can
// complete a real round trip. The special request-id prefix is also the native
// desktop's signal to nudge the Chat WebView runtime before a command is
// accepted.
func probeChatRuntime(
	ctx context.Context,
	sm *session.Manager,
) error {
	if sm == nil {
		return session.ErrAgentOffline
	}
	sessionEpoch, online := sm.ChatRuntimeProbeEpoch()
	if !online {
		return session.ErrAgentOffline
	}
	requestID := chatRuntimeWakeRequestPrefix + uuid.NewString()
	response, err := awaitAgentUnaryResponse(ctx, sm, requestID, &gatewayv1.GatewayEnvelope{
		RequestId: requestID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_Ping{
			Ping: &gatewayv1.PingRequest{Timestamp: time.Now().Unix()},
		},
	})
	if err != nil {
		return err
	}
	if response == nil || response.GetPong() == nil {
		return errors.New("desktop agent returned an invalid chat runtime probe response")
	}
	if !sm.RecordChatRuntimeProbe(sessionEpoch) {
		return session.ErrAgentOffline
	}
	return nil
}

func probeChatRuntimeForCommand(ctx context.Context, sm *session.Manager) error {
	if sm != nil && sm.ChatRuntimeProbeFresh(chatRuntimeProbeReuseWindow) {
		return nil
	}
	return probeChatRuntime(ctx, sm)
}

// watchAcceptedChatCommandStartup fails a command whose run never settled
// (started, finished, or parked in the desktop prompt queue) within the
// configured startup window.
func watchAcceptedChatCommandStartup(
	parent context.Context,
	cfg *config.Config,
	sm *session.Manager,
	runID string,
) {
	if sm == nil || strings.TrimSpace(runID) == "" {
		return
	}
	if !waitChatCommandWatchdog(parent, chatStartTimeout(cfg)) {
		return
	}
	if sm.ChatCommandSettled(runID) {
		return
	}
	if !waitChatCommandWatchdog(parent, chatRenderStartTimeout(cfg)) {
		return
	}
	if sm.ChatCommandSettled(runID) {
		return
	}
	sm.FailChatCommand(runID, "startup_timeout",
		"The desktop app did not start the remote chat request. Please retry.")
}

func waitChatCommandWatchdog(ctx context.Context, timeout time.Duration) bool {
	if timeout <= 0 {
		return true
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func chatStartTimeout(cfg *config.Config) time.Duration {
	if cfg != nil && cfg.ChatStartTimeout > 0 {
		return cfg.ChatStartTimeout
	}
	return 5 * time.Second
}

func chatRenderStartTimeout(cfg *config.Config) time.Duration {
	if cfg != nil && cfg.ChatRenderStartTimeout > 0 {
		return cfg.ChatRenderStartTimeout
	}
	return 10 * time.Second
}

func chatPrepareTimeout(cfg *config.Config) time.Duration {
	if cfg != nil && cfg.ChatPrepareTimeout > 0 {
		return cfg.ChatPrepareTimeout
	}
	return 2 * time.Second
}

func chatDeliveryTimeout(cfg *config.Config) time.Duration {
	if cfg != nil && cfg.ChatDeliveryTimeout > 0 {
		return cfg.ChatDeliveryTimeout
	}
	return 5 * time.Second
}

func buildAcceptedChatCommandPayloads(
	body handler.ChatRequestBody,
	baseMessageRef *chatCommandMessageRef,
) []map[string]any {
	payloads := make([]map[string]any, 0, 2)
	if baseMessageRef != nil {
		payloads = append(payloads, map[string]any{
			"type":             session.StreamEventRebased,
			"base_message_ref": baseMessageRef,
			"reason":           "edit_resend",
		})
	}
	payloads = append(payloads, buildUserMessageAppendedPayload(body, baseMessageRef))
	return payloads
}

func buildUserMessageAppendedPayload(
	body handler.ChatRequestBody,
	baseMessageRef *chatCommandMessageRef,
) map[string]any {
	payload := map[string]any{
		"type":                  "user_message",
		"message":               body.Message,
		"uploaded_files":        body.UploadedFiles,
		"execution_mode":        body.ExecutionMode,
		"workdir":               body.Workdir,
		"selected_system_tools": body.SelectedSystemTools,
		"runtime_controls":      body.RuntimeControls,
		"selected_model":        body.SelectedModel,
	}
	if baseMessageRef != nil {
		payload["base_message_ref"] = baseMessageRef
		payload["reason"] = "edit_resend"
	}
	return payload
}

func buildChatCommandEnvelope(
	requestID string,
	commandType string,
	body handler.ChatRequestBody,
	baseMessageRef *chatCommandMessageRef,
) *gatewayv1.GatewayEnvelope {
	return &gatewayv1.GatewayEnvelope{
		RequestId: strings.TrimSpace(requestID),
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.GatewayEnvelope_ChatCommand{
			ChatCommand: &gatewayv1.ChatCommandRequest{
				Type:           strings.TrimSpace(commandType),
				Request:        buildProtoChatRequest(body),
				BaseMessageRef: buildProtoChatMessageRef(baseMessageRef),
			},
		},
	}
}

func buildChatCancelCommandPayload(conversationID string) *gatewayv1.GatewayEnvelope_ChatCommand {
	return &gatewayv1.GatewayEnvelope_ChatCommand{
		ChatCommand: &gatewayv1.ChatCommandRequest{
			Type: "chat.cancel",
			Cancel: &gatewayv1.CancelChatRequest{
				ConversationId: strings.TrimSpace(conversationID),
			},
		},
	}
}

func buildProtoChatRequest(body handler.ChatRequestBody) *gatewayv1.ChatRequest {
	return &gatewayv1.ChatRequest{
		ConversationId:      body.ConversationID,
		ClientRequestId:     body.ClientRequestID,
		Message:             body.Message,
		SelectedModel:       handler.ToProtoChatSelectedModel(body.SelectedModel),
		RuntimeControls:     handler.ToProtoChatRuntimeControls(body.RuntimeControls),
		ExecutionMode:       body.ExecutionMode,
		Workdir:             body.Workdir,
		SelectedSystemTools: body.SelectedSystemTools,
		UploadedFiles:       handler.ToProtoChatUploadedFiles(body.UploadedFiles),
		QueuePolicy:         body.QueuePolicy,
	}
}

func buildProtoChatMessageRef(ref *chatCommandMessageRef) *gatewayv1.ChatMessageRef {
	if ref == nil {
		return nil
	}
	return &gatewayv1.ChatMessageRef{
		SegmentIndex: int32(ref.SegmentIndex),
		MessageIndex: int32(ref.MessageIndex),
		SegmentId:    strings.TrimSpace(ref.SegmentID),
		MessageId:    strings.TrimSpace(ref.MessageID),
		Role:         strings.TrimSpace(ref.Role),
		ContentHash:  strings.TrimSpace(ref.ContentHash),
	}
}

func validateChatMessageRef(ref *chatCommandMessageRef) error {
	if ref == nil {
		return nil
	}
	if ref.SegmentIndex < 0 || ref.MessageIndex < 0 {
		return errors.New("base_message_ref indexes must be non-negative")
	}
	ref.SegmentID = strings.TrimSpace(ref.SegmentID)
	ref.MessageID = strings.TrimSpace(ref.MessageID)
	ref.Role = strings.TrimSpace(ref.Role)
	ref.ContentHash = strings.TrimSpace(ref.ContentHash)
	if ref.SegmentID == "" || ref.MessageID == "" || ref.Role == "" || ref.ContentHash == "" {
		return errors.New("base_message_ref requires segment_id, message_id, role, and content_hash")
	}
	if ref.Role != "user" {
		return errors.New("base_message_ref role must be user")
	}
	return nil
}

func decodeChatCommandPayload(raw json.RawMessage) (string, handler.ChatRequestBody, *chatCommandMessageRef, error) {
	type commandEnvelope struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	type commandPayload struct {
		BaseMessageRef *chatCommandMessageRef `json:"base_message_ref,omitempty"`
		handler.ChatRequestBody
	}

	var envelope commandEnvelope
	if err := decodeStrictJSON(raw, &envelope); err != nil {
		return "", handler.ChatRequestBody{}, nil, err
	}

	commandType := strings.TrimSpace(envelope.Type)
	if commandType == "" {
		return "", handler.ChatRequestBody{}, nil, errors.New("chat command type is required")
	}
	if len(envelope.Payload) == 0 || string(envelope.Payload) == "null" {
		return "", handler.ChatRequestBody{}, nil, errors.New("chat command payload is required")
	}
	if commandType == "chat.cancel" {
		return commandType, handler.ChatRequestBody{}, nil, nil
	}

	var payload commandPayload
	if err := decodeStrictJSON(envelope.Payload, &payload); err != nil {
		return "", handler.ChatRequestBody{}, nil, err
	}

	return commandType, payload.ChatRequestBody, payload.BaseMessageRef, nil
}

func decodeStrictJSON(raw []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("invalid trailing JSON")
	}
	return nil
}
