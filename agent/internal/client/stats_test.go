package client

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseMeminfo(t *testing.T) {
	p := filepath.Join(t.TempDir(), "meminfo")
	os.WriteFile(p, []byte("MemTotal:        3915000 kB\nMemFree:  100 kB\nMemAvailable:    2334720 kB\n"), 0o600)
	f, _ := os.Open(p)
	defer f.Close()
	total, used := parseMeminfo(f)
	if total != 3823 || used != 1543 {
		t.Fatalf("got total=%d used=%d", total, used)
	}
}

func TestHostStatsDisk(t *testing.T) {
	if total, used := diskUsage("/"); total == 0 || used > total {
		t.Fatalf("disk total=%d used=%d", total, used)
	}
}
