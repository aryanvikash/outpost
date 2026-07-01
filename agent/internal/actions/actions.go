// Package actions implements the agent's allowlist of named actions.
//
// SECURITY MODEL: this is the only place that maps an action name to concrete
// commands. The API never supplies a command string — it sends a
// named action plus a constrained params object. Adding an action is a code
// change, reviewable in a PR. Unknown actions and invalid params are refused.
package actions

import (
	"context"
	"encoding/json"
	"fmt"
)

// LogFunc streams a chunk of output for a stream ("stdout" | "stderr").
// The client layer assigns sequence numbers and frames it as a protocol Log.
type LogFunc func(stream, chunk string)

// Handler executes an action. It returns the process exit code (0 == success)
// and an optional error for agent-level failures. Honor ctx for cancellation
// and timeouts.
type Handler func(ctx context.Context, params json.RawMessage, emit LogFunc) (int, error)

// Action is an allowlisted, named unit of work.
type Action struct {
	Name string
	// Idempotent marks actions that are safe to re-run after an interrupted
	// dispatch (drives redelivery semantics in the API).
	Idempotent bool
	Handle     Handler
}

// Registry is the closed set of supported actions. Keep in sync with
// PROTOCOL.md §7 and api/src/actions.ts.
var Registry = map[string]Action{
	"healthcheck": {Name: "healthcheck", Idempotent: true, Handle: handleHealthcheck},
	"deploy":      {Name: "deploy", Idempotent: false, Handle: handleDeploy},
	"restart":     {Name: "restart", Idempotent: true, Handle: handleRestart},
	"run-hook":    {Name: "run-hook", Idempotent: false, Handle: handleRunHook},
}

// Names returns the sorted-stable allowlist for the hello message.
func Names() []string {
	out := make([]string, 0, len(Registry))
	for _, name := range []string{"healthcheck", "deploy", "restart", "run-hook"} {
		if _, ok := Registry[name]; ok {
			out = append(out, name)
		}
	}
	return out
}

// Lookup returns the action and whether it is in the allowlist.
func Lookup(name string) (Action, bool) {
	a, ok := Registry[name]
	return a, ok
}

// ErrRefused indicates the action or its params were rejected (exit 126).
type ErrRefused struct{ Reason string }

func (e ErrRefused) Error() string { return e.Reason }

func refuse(format string, args ...any) error {
	return ErrRefused{Reason: fmt.Sprintf(format, args...)}
}
