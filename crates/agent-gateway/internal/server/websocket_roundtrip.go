package server

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/session"
)

func decodeWebSocketPayload(raw json.RawMessage, target any) error {
	if len(raw) == 0 {
		return json.Unmarshal([]byte("{}"), target)
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func waitForAgentEnvelope(
	ctx context.Context,
	ch <-chan *gatewayv1.AgentEnvelope,
	done <-chan struct{},
) (*gatewayv1.AgentEnvelope, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-done:
		return nil, session.ErrAgentOffline
	case env, ok := <-ch:
		if !ok {
			return nil, session.ErrAgentOffline
		}
		return env, nil
	}
}

func awaitAgentUnaryResponse(
	ctx context.Context,
	sm *session.Manager,
	requestID string,
	envelope *gatewayv1.GatewayEnvelope,
) (*gatewayv1.AgentEnvelope, error) {
	ch, done, cleanup, err := sm.RegisterStreamAndSendContext(ctx, requestID, envelope)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	return waitForAgentEnvelope(ctx, ch, done)
}

func websocketErrorMessage(err error) string {
	if err == nil {
		return "request failed"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "request timed out"
	}
	if errors.Is(err, context.Canceled) {
		return "request canceled"
	}
	if errors.Is(err, session.ErrAgentOffline) {
		return "agent offline"
	}
	return err.Error()
}

func requireTrimmedWebSocketString(value string, field string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", errors.New(field + " is required")
	}
	return trimmed, nil
}
