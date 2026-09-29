package client

import (
	"bufio"
	"os"
	"strconv"
	"strings"

	"github.com/aryanvikash/outpost/agent/internal/protocol"
)

// hostStats returns best-effort host telemetry for heartbeats, read from
// /proc and statfs (Linux). Anything unavailable is left zero and omitted.
func hostStats() *protocol.HostStats {
	s := &protocol.HostStats{}
	if b, err := os.ReadFile("/proc/uptime"); err == nil {
		if f := strings.Fields(string(b)); len(f) > 0 {
			up, _ := strconv.ParseFloat(f[0], 64)
			s.UptimeSec = uint64(up)
		}
	}
	if b, err := os.ReadFile("/proc/loadavg"); err == nil {
		if f := strings.Fields(string(b)); len(f) > 0 {
			s.Load1, _ = strconv.ParseFloat(f[0], 64)
		}
	}
	if f, err := os.Open("/proc/meminfo"); err == nil {
		s.MemTotalMb, s.MemUsedMb = parseMeminfo(f)
		f.Close()
	}
	s.DiskTotalMb, s.DiskUsedMb = diskUsage("/")
	return s
}

// parseMeminfo → (total, used) MB, where used = total − available (what `free` calls used + unreclaimable cache).
func parseMeminfo(f *os.File) (total, used uint64) {
	kb := map[string]uint64{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		n, _ := strconv.ParseUint(strings.Fields(v + " 0")[0], 10, 64)
		kb[k] = n
	}
	total, avail := kb["MemTotal"], kb["MemAvailable"]
	if total == 0 || avail > total {
		return 0, 0
	}
	return total / 1024, (total - avail) / 1024
}
