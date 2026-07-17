package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/liveagent/agent-gateway/internal/config"
	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/session"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

func TestNewGRPCServerUsesTLSWhenCertificateConfigured(t *testing.T) {
	certFile, keyFile, certPEM := writeTestCertificate(t)
	cfg := &config.Config{
		Token:               "secret-token",
		TLSCert:             certFile,
		TLSKey:              keyFile,
		GRPCMaxMessageBytes: config.DefaultGRPCMaxMessageBytes,
	}

	grpcServer, err := newGRPCServer(cfg, session.NewManager())
	if err != nil {
		t.Fatalf("newGRPCServer returned error: %v", err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() {
		grpcServer.Stop()
		_ = listener.Close()
	})

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- grpcServer.Serve(listener)
	}()

	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(certPEM) {
		t.Fatalf("failed to load test certificate")
	}
	creds := credentials.NewTLS(&tls.Config{
		MinVersion: tls.VersionTLS12,
		RootCAs:    roots,
		ServerName: "localhost",
	})
	conn, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(creds))
	if err != nil {
		t.Fatalf("dial TLS gRPC: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	resp, err := gatewayv1.NewAgentGatewayClient(conn).Authenticate(ctx, &gatewayv1.AuthRequest{
		Token:        " secret-token\r\n",
		AgentId:      "test-agent",
		AgentVersion: "test",
	})
	if err != nil {
		t.Fatalf("Authenticate over TLS failed: %v", err)
	}
	if !resp.GetSuccess() {
		t.Fatalf("Authenticate success = false, message = %q", resp.GetMessage())
	}

	grpcServer.Stop()
	select {
	case err := <-serveErr:
		if err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			t.Fatalf("Serve returned error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("gRPC server did not stop")
	}
}

func writeTestCertificate(t *testing.T) (string, string, []byte) {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: "localhost",
		},
		NotBefore: time.Now().Add(-time.Hour),
		NotAfter:  time.Now().Add(time.Hour),
		KeyUsage:  x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{
			x509.ExtKeyUsageServerAuth,
		},
		DNSNames:    []string{"localhost"},
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})

	dir := t.TempDir()
	certFile := filepath.Join(dir, "server.crt")
	keyFile := filepath.Join(dir, "server.key")
	if err := os.WriteFile(certFile, certPEM, 0o600); err != nil {
		t.Fatalf("write cert: %v", err)
	}
	if err := os.WriteFile(keyFile, keyPEM, 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}
	return certFile, keyFile, certPEM
}
