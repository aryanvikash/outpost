//go:build unix

package actions

import (
	"os"
	"syscall"
)

// hookOwnedByAgent reports whether the file is owned by the agent's own uid —
// if so the agent could modify it, so it's unsafe to execute.
func hookOwnedByAgent(info os.FileInfo) bool {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		return int(st.Uid) == os.Getuid()
	}
	return false
}
