package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/aryanvikash/outpost/agent/internal/protocol"
)

// Host-defined hooks let an operator add custom commands (deploy recipes,
// "pull", "migrate", …) WITHOUT the API ever sending a command string.
// The operator drops a script in the hooks dir; the API triggers it by
// validated name. The only hard requirement is that the file is not group/world-
// writable, so another user on the box can't tamper with what runs. The execute
// bit is optional — a non-executable script is run via `sh` — so dropping a file
// in place "just works" without a chmod.

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

// HooksDir is the resolved hooks directory (exported for the CLI so `hook edit`
// writes to exactly where the running agent reads).
func HooksDir() string { return hooksDir() }

// ValidHookName reports whether name is usable as a hook name.
func ValidHookName(name string) bool { return validHookName(name) }

// ignoredHookExt are non-hook files that may legitimately live in the hooks dir
// (templates, notes) — never reported as problems.
var ignoredHookExt = map[string]bool{
	".example": true, ".sample": true, ".md": true, ".txt": true,
	".bak": true, ".orig": true, ".disabled": true,
}

// HookTemplate returns starter content for a new hook of the given name.
func HookTemplate(name string) string {
	if name == "deploy" {
		return `#!/bin/sh
# Outpost deploy hook — runs on the dashboard "Deploy" button and on git push.
# Edit the two values below, then save. No chmod needed.
set -eu

APP_DIR="$HOME/myapp"     # <-- your app directory
PM2_APP="myapp"           # <-- your pm2 process name

cd "$APP_DIR"
echo "==> deploy $PM2_APP (branch=${OUTPOST_BRANCH:-current})"
git pull --ff-only
npm ci
npm run build
pm2 restart "$PM2_APP" --update-env
echo "==> done"
`
	}
	return `#!/bin/sh
# Outpost custom command "` + name + `" — runs from the dashboard.
set -eu

echo "running ` + name + `"
# add your commands here
`
}

// checkHook validates a hook is safe to run: a regular file that is not group/
// world-writable (so other users on the box can't tamper with it). The execute
// bit is NOT required — runHook runs a non-executable script via `sh`. In a
// system install the hooks dir is root-owned so the agent can't modify hooks; in
// a rootless install the agent and the hook author are the same user.
func checkHook(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("not a regular file")
	}
	if info.Mode().Perm()&0o022 != 0 {
		return fmt.Errorf("group/world-writable — run: chmod o-w,g-w %s", path)
	}
	return nil
}

// hookIsExecutable reports whether the file carries an execute bit, deciding
// whether to exec it directly (honoring its shebang) or run it via `sh`.
func hookIsExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().Perm()&0o111 != 0
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
	if hookIsExecutable(path) {
		return runCommandEnv(ctx, emit, extraEnv, path)
	}
	// No execute bit: run through the shell so no `chmod +x` is needed.
	return runCommandEnv(ctx, emit, extraEnv, "/bin/sh", path)
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

// ListHookIssues returns files in the hooks dir that look like intended hooks but
// can't be run, with the reason — so the dashboard can surface the problem
// instead of the agent silently ignoring them. Dotfiles and `_`-prefixed helper
// files (e.g. a sourced library) are intentionally skipped.
func ListHookIssues() []protocol.HookIssue {
	entries, err := os.ReadDir(hooksDir())
	if err != nil {
		return nil
	}
	var issues []protocol.HookIssue
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") {
			continue
		}
		if ignoredHookExt[strings.ToLower(filepath.Ext(name))] {
			continue
		}
		if !validHookName(name) {
			issues = append(issues, protocol.HookIssue{
				Name:   name,
				Reason: "invalid hook name — use lowercase letters, digits, '-', '_' (no dots or uppercase)",
			})
			continue
		}
		if err := checkHook(filepath.Join(hooksDir(), name)); err != nil {
			issues = append(issues, protocol.HookIssue{Name: name, Reason: err.Error()})
		}
	}
	sort.Slice(issues, func(i, j int) bool { return issues[i].Name < issues[j].Name })
	return issues
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
