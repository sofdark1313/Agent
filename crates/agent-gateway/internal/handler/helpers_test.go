package handler

import (
	"net/http"
	"testing"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
)

func TestGatewayErrorStatusPassesExpectedClientErrors(t *testing.T) {
	t.Parallel()

	cases := map[int32]int{
		http.StatusBadRequest:   http.StatusBadRequest,
		http.StatusUnauthorized: http.StatusUnauthorized,
		http.StatusForbidden:    http.StatusForbidden,
		http.StatusNotFound:     http.StatusNotFound,
		http.StatusConflict:     http.StatusConflict,
		http.StatusTeapot:       http.StatusBadGateway,
		0:                       http.StatusBadGateway,
	}

	for code, want := range cases {
		got := GatewayErrorStatus(&gatewayv1.ErrorResponse{Code: code})
		if got != want {
			t.Fatalf("GatewayErrorStatus(%d) = %d, want %d", code, got, want)
		}
	}
}
