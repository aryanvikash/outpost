package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"time"
)

// handleHealthcheck returns basic host info. Trivial and side-effect free — it's
// the Phase-2 end-to-end smoke test.
func handleHealthcheck(_ context.Context, _ json.RawMessage, emit LogFunc) (int, error) {
	host, _ := os.Hostname()
	emit("stdout", fmt.Sprintf("hostname: %s\n", host))
	emit("stdout", fmt.Sprintf("os/arch:  %s/%s\n", runtime.GOOS, runtime.GOARCH))
	emit("stdout", fmt.Sprintf("go:       %s\n", runtime.Version()))
	emit("stdout", fmt.Sprintf("time:     %s\n", time.Now().UTC().Format(time.RFC3339)))
	emit("stdout", "status:   ok\n")
	return 0, nil
}
