package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/liveagent/agent-gateway/internal/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestHTTPMiddlewareRequiresValidBearerToken(t *testing.T) {
	t.Parallel()

	var called bool
	handler := auth.HTTPMiddleware(" secret-token\r\n", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	cases := []struct {
		name          string
		authorization string
		wantStatus    int
		wantCalled    bool
	}{
		{
			name:       "missing header",
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:          "wrong scheme",
			authorization: "Token secret-token",
			wantStatus:    http.StatusUnauthorized,
		},
		{
			name:          "wrong token",
			authorization: "Bearer wrong",
			wantStatus:    http.StatusUnauthorized,
		},
		{
			name:          "valid bearer token with whitespace",
			authorization: "  bearer   secret-token  ",
			wantStatus:    http.StatusNoContent,
			wantCalled:    true,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			called = false
			req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
			if tc.authorization != "" {
				req.Header.Set("Authorization", tc.authorization)
			}
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if called != tc.wantCalled {
				t.Fatalf("handler called = %v, want %v", called, tc.wantCalled)
			}
		})
	}
}

func TestValidateTokenTrimsAndRejectsEmptyValues(t *testing.T) {
	t.Parallel()

	if !auth.ValidateToken(" secret-token ", "\nsecret-token\r\n") {
		t.Fatal("ValidateToken should accept matching trimmed tokens")
	}
	if auth.ValidateToken("", "secret-token") {
		t.Fatal("ValidateToken should reject empty input token")
	}
	if auth.ValidateToken("secret-token", "") {
		t.Fatal("ValidateToken should reject empty expected token")
	}
	if auth.ValidateToken("wrong-token", "secret-token") {
		t.Fatal("ValidateToken should reject mismatched tokens")
	}
}

func TestGRPCUnaryInterceptorAuthBoundary(t *testing.T) {
	t.Parallel()

	interceptor := auth.GRPCUnaryInterceptor(" secret-token\r\n")
	handler := func(_ context.Context, req any) (any, error) {
		return req, nil
	}

	got, err := interceptor(
		context.Background(),
		"auth request",
		&grpc.UnaryServerInfo{FullMethod: "/liveagent.gateway.v1.AgentGateway/Authenticate"},
		handler,
	)
	if err != nil {
		t.Fatalf("Authenticate should bypass metadata auth: %v", err)
	}
	if got != "auth request" {
		t.Fatalf("handler result = %#v", got)
	}

	_, err = interceptor(
		context.Background(),
		"protected request",
		&grpc.UnaryServerInfo{FullMethod: "/liveagent.gateway.v1.AgentGateway/Other"},
		handler,
	)
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("missing metadata code = %v, want %v", status.Code(err), codes.Unauthenticated)
	}

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("authorization", "Bearer secret-token"))
	got, err = interceptor(
		ctx,
		"protected request",
		&grpc.UnaryServerInfo{FullMethod: "/liveagent.gateway.v1.AgentGateway/Other"},
		handler,
	)
	if err != nil {
		t.Fatalf("valid bearer metadata rejected: %v", err)
	}
	if got != "protected request" {
		t.Fatalf("handler result = %#v", got)
	}
}
