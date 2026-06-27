package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
)

// Host-defined hooks let an operator add custom commands (deploy recipes,
// "pull", "migrate", …) WITHOUT the control plane ever sending a command string.
// The operator drops an executable script in the hooks dir; the control plane
// triggers it by validated name. The agent refuses to run a hook it could modify
// itself, so a compromised agent/control plane can't rewrite what runs.

var hookNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

func hooksDir() string { return envOr("OUTPOST_HOOKS_DIR", "/etc/outpost/hooks") }

func validHookName(name string) bool { return hookNameRe.MatchString(name) }

// checkHook validates a hook is safe to run: a regular, executable file that is
// not group/world-writable and not owned by the agent user.
func checkHook(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("not a regular file")
	}
	if info.Mode().Perm()&0o111 == 0 {
		return fmt.Errorf("not executable")
	}
	if info.Mode().Perm()&0o022 != 0 {
		return fmt.Errorf("must not be group/world writable")
	}
	if hookOwnedByAgent(info) {
		return fmt.Errorf("must not be owned by the agent user")
	}
	return nil
}

// runHook runs a validated host hook, streaming its output. extraEnv is appended
// to the agent environment (e.g. OUTPOST_BRANCH for deploy).
func runHook(ctx context.Context, emit LogFunc, name string, extraEnv []string) (int, error) {
	if !validHookName(name) {
		return 0, refuse("invalid hook name: %q", name)
	}
	path := filepath.Join(hooksDir(), name)
	if err := checkHook(path); err != nil {
		return 0, refuse("hook %q: %v", name, err)
	}
	emit("stdout", "running hook "+path+"\n")
	return runCommandEnv(ctx, emit, extraEnv, path)
}

// ListHooks returns the names of valid, runnable hooks (reported to the UI).
func ListHooks() []string {
	entries, err := os.ReadDir(hooksDir())
	if err != nil {
		return nil
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() || !validHookName(e.Name()) {
			continue
		}
		if checkHook(filepath.Join(hooksDir(), e.Name())) == nil {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names
}

// hasDeployHook reports whether a usable deploy hook exists.
func hasDeployHook() bool {
	return checkHook(filepath.Join(hooksDir(), "deploy")) == nil
}

type runHookParams struct {
	Name string `json:"name"`
}

// handleRunHook runs an arbitrary host-defined hook by name.
func handleRunHook(ctx context.Context, raw json.RawMessage, emit LogFunc) (int, error) {
	var p runHookParams
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &p); err != nil {
			return 0, refuse("invalid params: %v", err)
		}
	}
	if p.Name == "" {
		return 0, refuse("hook name required")
	}
	return runHook(ctx, emit, p.Name, nil)
}
