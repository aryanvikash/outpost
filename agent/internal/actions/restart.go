package actions

import (
	"context"
	"encoding/json"
)

type restartParams struct {
	App string `json:"app"`
}

// handleRestart performs a zero-downtime PM2 reload of an app. Idempotent.
// The app name is validated; if omitted it defaults to the configured target.
func handleRestart(ctx context.Context, raw json.RawMessage, emit LogFunc) (int, error) {
	var p restartParams
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &p); err != nil {
			return 0, refuse("invalid params: %v", err)
		}
	}
	app := p.App
	if app == "" {
		app = envOr("OUTPOST_PM2_TARGET", "ecosystem.config.js")
	} else if !validApp(app) {
		return 0, refuse("invalid app: %q", app)
	}
	return runCommand(ctx, emit, "pm2", "reload", app)
}
