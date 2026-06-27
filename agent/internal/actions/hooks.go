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

// hooksDir resolves where host hooks live, no sudo required for user installs:
//   - $OUTPOST_HOOKS_DIR if set (the systemd unit sets /etc/outpost/hooks);
//   - else the per-user config dir (~/.config/outpost/hooks on Linux) — writable
//     without root;
//   - else /etc/outpost/hooks as a last resort.
func hooksDir() string {
	if v := os.Getenv("OUTPOST_HOOKS_DIR"); v != "" {
		return v
	}
	if dir, err := os.UserConfigDir(); err == nil && dir != "" {
		return filepath.Join(dir, "outpost", "hooks")
	}
	return "/etc/outpost/hooks"
}

func validHookName(name string) bool { return hookNameRe.MatchString(name) }

// checkHook validates a hook is safe to run: a regular, executable file that is
// not group/world-writable (so other users on the box can't tamper with it). In
// a system install, the hooks dir is root-owned so the agent can't modify hooks;
// in a rootless install the agent and the hook author are the same user, so no
// further ownership check applies.
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
