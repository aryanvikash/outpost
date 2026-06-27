//go:build !unix

package actions

import "os/exec"

// configureProcessGroup is a no-op on non-unix platforms (dev convenience only;
// the agent ships for linux).
func configureProcessGroup(cmd *exec.Cmd) {}

// killProcessGroup falls back to killing just the process.
func killProcessGroup(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
