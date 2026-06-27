//go:build unix

package actions

import (
	"os/exec"
	"syscall"
)

// configureProcessGroup puts the child in its own process group so we can signal
// the whole group (including grandchildren like git/npm subprocesses) at once.
func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killProcessGroup sends SIGKILL to the child's entire process group.
func killProcessGroup(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	// Negative pid targets the process group led by the child.
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}
