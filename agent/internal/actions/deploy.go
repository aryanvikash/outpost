package actions

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/aryanvikash/outpost/agent/internal/protocol"
)

// DeployInfo reports this host's deploy target so the control plane/UI can show
// it. The repo URL is resolved best-effort from the checkout; empty if the path
// doesn't exist or isn't a git repo.
func DeployInfo() protocol.DeployConfig {
	cfg := loadDeployConfig()
	info := protocol.DeployConfig{
		AppDir:    cfg.appDir,
		Remote:    cfg.remote,
		PM2Target: cfg.pm2Target,
		Mode:      "pm2",
	}
	if hasDeployHook() {
		info.Mode = "hook"
		info.HookPath = filepath.Join(hooksDir(), "deploy")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "git", "-C", cfg.appDir, "remote", "get-url", cfg.remote).Output()
	if err == nil {
		info.RepoURL = strings.TrimSpace(string(out))
	}
	return info
}

// deployParams is the constrained input to the deploy action. The only
// operator-supplied value is the branch; everything else (app directory, PM2
// app/ecosystem) is agent-side configuration, NOT attacker-controlled.
type deployParams struct {
	Branch string `json:"branch"`
}

// deployConfig is read from the agent's environment (set by the systemd unit /
// config), keeping deploy targets out of the wire protocol.
type deployConfig struct {
	appDir    string // git working tree, e.g. /srv/app
	pm2Target string // pm2 app name or ecosystem file, e.g. ecosystem.config.js
	remote    string // git remote, e.g. origin
}

func loadDeployConfig() deployConfig {
	return deployConfig{
		appDir:    envOr("OUTPOST_APP_DIR", "/srv/app"),
		pm2Target: envOr("OUTPOST_PM2_TARGET", "ecosystem.config.js"),
		remote:    envOr("OUTPOST_GIT_REMOTE", "origin"),
	}
}

// handleDeploy runs the deploy sequence for a PM2-managed Node app. The concrete
// commands are defined HERE, parameterized only by the validated branch.
//
//	git -C <dir> fetch --prune <remote>
//	git -C <dir> checkout <branch>
//	git -C <dir> pull --ff-only <remote> <branch>
//	npm --prefix <dir> ci --omit=dev
//	pm2 reload <target>
func handleDeploy(ctx context.Context, raw json.RawMessage, emit LogFunc) (int, error) {
	var p deployParams
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &p); err != nil {
			return 0, refuse("invalid params: %v", err)
		}
	}
	branch := p.Branch
	if branch == "" {
		branch = "main"
	}
	if !validBranch(branch) {
		return 0, refuse("invalid branch: %q", branch)
	}

	// Prefer a host-defined deploy hook (works for any stack: pip/supervisor,
	// docker-compose, etc.); fall back to the built-in PM2/Node flow.
	if hasDeployHook() {
		return runHook(ctx, emit, "deploy", []string{"OUTPOST_BRANCH=" + branch})
	}

	cfg := loadDeployConfig()
	emit("stdout", "deploying branch "+branch+" to "+cfg.appDir+"\n")

	cmds := [][]string{
		{"git", "-C", cfg.appDir, "fetch", "--prune", cfg.remote},
		{"git", "-C", cfg.appDir, "checkout", branch},
		{"git", "-C", cfg.appDir, "pull", "--ff-only", cfg.remote, branch},
		{"npm", "--prefix", cfg.appDir, "ci", "--omit=dev"},
		{"pm2", "reload", cfg.pm2Target},
	}
	return runSequence(ctx, emit, cmds)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
