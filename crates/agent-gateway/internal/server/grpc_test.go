package server

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/liveagent/agent-gateway/internal/config"
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/session"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

func TestAgentTerminalConnectSendsReadyFrame(t *testing.T) {
	listener := bufconn.Listen(1024 * 1024)
	grpcServer := grpc.NewServer()
	gatewayv1.RegisterAgentGatewayServer(grpcServer, NewGRPCServer(&config.Config{}, session.NewManager()))
	t.Cleanup(func() {
		grpcServer.Stop()
		_ = listener.Close()
	})

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- grpcServer.Serve(listener)
	}()

	conn, err := grpc.NewClient(
		"passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial bufconn gRPC: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	stream, err := gatewayv1.NewAgentGatewayClient(conn).AgentTerminalConnect(ctx)
	if err != nil {
		t.Fatalf("open terminal stream: %v", err)
	}
	frame, err := stream.Recv()
	if err != nil {
		t.Fatalf("receive terminal ready frame: %v", err)
	}
	if frame.GetKind() != "detach" {
		t.Fatalf("ready frame kind = %q, want detach", frame.GetKind())
	}
	if streamID := frame.GetStreamId(); len(streamID) < len("gateway-ready-") || streamID[:len("gateway-ready-")] != "gateway-ready-" {
		t.Fatalf("ready frame stream id = %q, want gateway-ready-*", streamID)
	}

	grpcServer.Stop()
	select {
	case err := <-serveErr:
		if err != nil && err != grpc.ErrServerStopped {
			t.Fatalf("Serve returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("gRPC server did not stop")
	}
}

func TestAgentConnectTouchesHeartbeatOnAnyEnvelope(t *testing.T) {
	listener := bufconn.Listen(1024 * 1024)
	sm := session.NewManager()
	grpcServer := grpc.NewServer()
	gatewayv1.RegisterAgentGatewayServer(
		grpcServer,
		NewGRPCServer(&config.Config{HeartbeatPeriod: 100 * time.Millisecond}, sm),
	)
	t.Cleanup(func() {
		grpcServer.Stop()
		_ = listener.Close()
	})
	go func() {
		_ = grpcServer.Serve(listener)
	}()

	conn, err := grpc.NewClient(
		"passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial bufconn gRPC: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	stream, err := gatewayv1.NewAgentGatewayClient(conn).AgentConnect(ctx)
	if err != nil {
		t.Fatalf("open agent stream: %v", err)
	}

	// The dedicated lane must deliver pings regardless of data-queue state.
	if _, err := stream.Recv(); err != nil {
		t.Fatalf("receive initial ping: %v", err)
	}

	// Never send a Pong: non-pong traffic alone must keep the session alive
	// through several staleness windows (timeout = 3 x 100ms period).
	deadline := time.Now().Add(700 * time.Millisecond)
	for time.Now().Before(deadline) {
		if err := stream.Send(&gatewayv1.AgentEnvelope{RequestId: "activity"}); err != nil {
			t.Fatalf("send activity envelope: %v", err)
		}
		if !sm.IsOnline() {
			t.Fatalf("session cleared while agent was actively sending")
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Once traffic stops, the staleness sweep must still clear the session.
	waitUntil := time.Now().Add(2 * time.Second)
	for sm.IsOnline() {
		if time.Now().After(waitUntil) {
			t.Fatalf("session not cleared after inbound traffic stopped")
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func TestAgentConnectDispatchesCorrelatedPong(t *testing.T) {
	t.Parallel()

	listener := bufconn.Listen(1024 * 1024)
	sm := session.NewManager()
	grpcServer := grpc.NewServer()
	gatewayv1.RegisterAgentGatewayServer(
		grpcServer,
		NewGRPCServer(&config.Config{HeartbeatPeriod: time.Hour}, sm),
	)
	t.Cleanup(func() {
		grpcServer.Stop()
		_ = listener.Close()
	})
	go func() { _ = grpcServer.Serve(listener) }()

	conn, err := grpc.NewClient(
		"passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial bufconn gRPC: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	stream, err := gatewayv1.NewAgentGatewayClient(conn).AgentConnect(ctx)
	if err != nil {
		t.Fatalf("open agent stream: %v", err)
	}
	if _, err := stream.Recv(); err != nil {
		t.Fatalf("receive initial heartbeat: %v", err)
	}

	const requestID = "chat-runtime-wake-correlated"
	responses, done, cleanup, err := sm.RegisterStream(requestID)
	if err != nil {
		t.Fatalf("register correlated response stream: %v", err)
	}
	defer cleanup()
	sendResult := make(chan error, 1)
	go func() {
		sendResult <- sm.SendToAgentContext(ctx, &gatewayv1.GatewayEnvelope{
			RequestId: requestID,
			Timestamp: time.Now().Unix(),
			Payload: &gatewayv1.GatewayEnvelope_Ping{
				Ping: &gatewayv1.PingRequest{Timestamp: time.Now().Unix()},
			},
		})
	}()

	probe, err := stream.Recv()
	if err != nil {
		t.Fatalf("receive correlated probe: %v", err)
	}
	if probe.GetRequestId() != requestID || probe.GetPing() == nil {
		t.Fatalf("correlated probe = %#v", probe)
	}
	if err := stream.Send(&gatewayv1.AgentEnvelope{
		RequestId: requestID,
		Timestamp: time.Now().Unix(),
		Payload: &gatewayv1.AgentEnvelope_Pong{
			Pong: &gatewayv1.PongResponse{Timestamp: probe.GetPing().GetTimestamp()},
		},
	}); err != nil {
		t.Fatalf("send correlated pong: %v", err)
	}

	select {
	case response := <-responses:
		if response.GetRequestId() != requestID || response.GetPong() == nil {
			t.Fatalf("correlated response = %#v", response)
		}
	case <-done:
		t.Fatal("correlated response stream closed before Pong dispatch")
	case <-ctx.Done():
		t.Fatalf("timed out waiting for correlated Pong: %v", ctx.Err())
	}
	select {
	case err := <-sendResult:
		if err != nil {
			t.Fatalf("send correlated probe: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("timed out waiting for probe delivery ack: %v", ctx.Err())
	}
}
