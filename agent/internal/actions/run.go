package actions

import (
	"bufio"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/aryanvikash/outpost/agent/internal/protocol"
)

// runCommand executes a command (never via a shell — argv only, so shell
// metacharacters in validated params are inert), streaming stdout/stderr through
// emit as they arrive. It returns the process exit code.
//
// The command runs in its own process group; on ctx cancellation/timeout the
// whole group is killed so child processes (git, npm, pm2) don't linger.
func runCommand(ctx context.Context, emit LogFunc, name string, args ...string) (int, error) {
	return runCommandEnv(ctx, emit, nil, name, args...)
}

// runCommandEnv is runCommand with extra environment variables appended to the
// agent's own environment (used to pass validated params to hook scripts).
func runCommandEnv(ctx context.Context, emit LogFunc, extraEnv []string, name string, args ...string) (int, error) {
	emit("stdout", "$ "+name+" "+joinArgs(args)+"\n")

	cmd := exec.Command(name, args...)
	if len(extraEnv) > 0 {
		cmd.Env = append(os.Environ(), extraEnv...)
	}
	configureProcessGroup(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return protocol.ExitStartFailed, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return protocol.ExitStartFailed, err
	}

	if err := cmd.Start(); err != nil {
		return protocol.ExitStartFailed, err
	}

	// Kill the whole process group if the context ends before the command does.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			killProcessGroup(cmd)
		case <-done:
		}
	}()

	var wg sync.WaitGroup
	wg.Add(2)
	go streamPipe(&wg, stdout, "stdout", emit)
	go streamPipe(&wg, stderr, "stderr", emit)
	wg.Wait()

	err = cmd.Wait()

	if ctxErr := ctx.Err(); errors.Is(ctxErr, context.DeadlineExceeded) {
		return protocol.ExitTimeout, ctxErr
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return protocol.ExitTerminated, ctx.Err()
	}
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return exitErr.ExitCode(), nil
		}
		return protocol.ExitStartFailed, err
	}
	return 0, nil
}

// runSequence runs commands in order, stopping at the first non-zero exit.
func runSequence(ctx context.Context, emit LogFunc, cmds [][]string) (int, error) {
	for _, c := range cmds {
		code, err := runCommand(ctx, emit, c[0], c[1:]...)
		if err != nil {
			return code, err
		}
		if code != 0 {
			emit("stderr", "command exited with code "+itoa(code)+", aborting sequence\n")
			return code, nil
		}
	}
	return 0, nil
}

func streamPipe(wg *sync.WaitGroup, r io.Reader, stream string, emit LogFunc) {
	defer wg.Done()
	br := bufio.NewReaderSize(r, 32*1024)
	buf := make([]byte, 16*1024)
	for {
		n, err := br.Read(buf)
		if n > 0 {
			emit(stream, string(buf[:n]))
		}
		if err != nil {
			return
		}
	}
}

func joinArgs(args []string) string {
	out := ""
	for i, a := range args {
		if i > 0 {
			out += " "
		}
		out += a
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
