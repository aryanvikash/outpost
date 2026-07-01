package client

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/aryanvikash/outpost/agent/internal/config"
)

// keepaliveLoop must return as soon as its connection context is canceled (the
// normal-disconnect path), without leaking a goroutine or touching the socket.
func TestKeepaliveLoopStopsOnContextCancel(t *testing.T) {
	c := New(config.Config{}, nil, "test", slog.New(slog.NewTextHandler(io.Discard, nil)))

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already canceled: the loop should exit on the first select

	done := make(chan struct{})
	// conn is nil, but a canceled ctx means the ctx.Done() case wins before any
	// ping is attempted, so it is never dereferenced.
	go func() {
		c.keepaliveLoop(ctx, nil, func() {})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("keepaliveLoop did not stop on canceled context")
	}
}
