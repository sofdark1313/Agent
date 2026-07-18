package main

import (
	"sync"
	"testing"
	"time"
)

type fakeGRPCServer struct {
	gracefulDone chan struct{}
	stopCalled   chan struct{}
	stopOnce     sync.Once
}

func newFakeGRPCServer() *fakeGRPCServer {
	return &fakeGRPCServer{
		gracefulDone: make(chan struct{}),
		stopCalled:   make(chan struct{}),
	}
}

func (f *fakeGRPCServer) GracefulStop() {
	<-f.gracefulDone
}

func (f *fakeGRPCServer) Stop() {
	f.stopOnce.Do(func() {
		close(f.stopCalled)
		close(f.gracefulDone)
	})
}

func TestShutdownGRPCServerGraceful(t *testing.T) {
	server := newFakeGRPCServer()
	close(server.gracefulDone)

	if forced := shutdownGRPCServer(server, 50*time.Millisecond); forced {
		t.Fatalf("expected graceful shutdown without forcing stop")
	}

	select {
	case <-server.stopCalled:
		t.Fatalf("did not expect Stop to be called")
	default:
	}
}

func TestShutdownGRPCServerForcesStopAfterTimeout(t *testing.T) {
	server := newFakeGRPCServer()

	start := time.Now()
	if forced := shutdownGRPCServer(server, 20*time.Millisecond); !forced {
		t.Fatalf("expected forced shutdown after timeout")
	}

	select {
	case <-server.stopCalled:
	case <-time.After(200 * time.Millisecond):
		t.Fatalf("expected Stop to be called after timeout")
	}

	if time.Since(start) < 20*time.Millisecond {
		t.Fatalf("shutdown returned before timeout elapsed")
	}
}
