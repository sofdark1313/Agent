package main

import "time"

type grpcShutdownServer interface {
	GracefulStop()
	Stop()
}

func shutdownGRPCServer(server grpcShutdownServer, timeout time.Duration) bool {
	done := make(chan struct{})

	go func() {
		server.GracefulStop()
		close(done)
	}()

	if timeout <= 0 {
		<-done
		return false
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-done:
		return false
	case <-timer.C:
		server.Stop()
		return true
	}
}
