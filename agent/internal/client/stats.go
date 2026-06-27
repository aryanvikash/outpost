package client

import (
	"runtime"

	"github.com/aryanvikash/outpost/agent/internal/protocol"
)

// hostStats returns best-effort host telemetry for heartbeats. Kept dependency-
// free (stdlib only); fields that aren't cheaply available are left zero/omitted.
func hostStats() *protocol.HostStats {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return &protocol.HostStats{
		MemUsedMb: m.Alloc / (1024 * 1024),
	}
}
