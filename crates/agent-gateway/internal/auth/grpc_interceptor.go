package auth

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const authenticateMethod = "/liveagent.gateway.v1.AgentGateway/Authenticate"

func GRPCUnaryInterceptor(expectedToken string) grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req any,
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (any, error) {
		if info.FullMethod != authenticateMethod && !validateMetadataToken(ctx, expectedToken) {
			return nil, status.Error(codes.Unauthenticated, "invalid token")
		}
		return handler(ctx, req)
	}
}

func GRPCStreamInterceptor(expectedToken string) grpc.StreamServerInterceptor {
	return func(
		srv any,
		stream grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		if !validateMetadataToken(stream.Context(), expectedToken) {
			return status.Error(codes.Unauthenticated, "invalid token")
		}
		return handler(srv, stream)
	}
}

func validateMetadataToken(ctx context.Context, expectedToken string) bool {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return false
	}
	if values := md.Get("authorization"); len(values) > 0 {
		for _, value := range values {
			if ValidateBearerHeader(value, expectedToken) {
				return true
			}
		}
	}
	if values := md.Get("token"); len(values) > 0 {
		for _, value := range values {
			if ValidateToken(value, expectedToken) {
				return true
			}
		}
	}
	return false
}
