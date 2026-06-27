package actions

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/aryanvikash/outpost/agent/internal/protocol"
)

// collect runs an action and returns its exit code, error, and combined output.
func collect(t *testing.T, name string, params string) (int, error, string) {
	t.Helper()
	a, ok := Lookup(name)
	if !ok {
		t.Fatalf("action %q not in allowlist", name)
	}
	var sb strings.Builder
	emit := func(stream, chunk string) { sb.WriteString(chunk) }
	code, err := a.Handle(context.Background(), json.RawMessage(params), emit)
	return code, err, sb.String()
}

func TestAllowlistRejectsUnknownAction(t *testing.T) {
	if _, ok := Lookup("rm-rf"); ok {
		t.Fatal("unknown action must not be in the allowlist")
	}
	if _, ok := Lookup("../../etc/passwd"); ok {
		t.Fatal("path-like action must not be in the allowlist")
	}
}

func TestNamesIsTheClosedSet(t *testing.T) {
	want := map[string]bool{
		"healthcheck": true,
		"deploy":      true,
		"restart":     true,
		"run-hook":    true,
	}
	for _, n := range Names() {
		if !want[n] {
			t.Errorf("unexpected action exposed: %q", n)
		}
		delete(want, n)
	}
	if len(want) != 0 {
		t.Errorf("missing actions: %v", want)
	}
}

func TestHealthcheckSucceeds(t *testing.T) {
	code, err, out := collect(t, "healthcheck", "{}")
	if err != nil || code != 0 {
		t.Fatalf("healthcheck failed: code=%d err=%v", code, err)
	}
	if !strings.Contains(out, "status:   ok") {
		t.Errorf("expected ok status, got: %q", out)
	}
}

func TestDeployRejectsInjectionInBranch(t *testing.T) {
	cases := []string{
		`{"branch":"main; rm -rf /"}`,
		`{"branch":"$(curl evil)"}`,
		`{"branch":"--upload-pack=evil"}`,
		`{"branch":"-oProxyCommand=evil"}`,
		`{"branch":"a..b"}`,
		`{"branch":"`+strings.Repeat("a", 300)+`"}`,
	}
	for _, c := range cases {
		code, err, _ := collect(t, "deploy", c)
		var refused ErrRefused
		if err == nil || !asRefused(err, &refused) {
			t.Errorf("expected refusal for params %s (got code=%d err=%v)", c, code, err)
		}
	}
}

func TestRestartRejectsInvalidApp(t *testing.T) {
	code, err, _ := collect(t, "restart", `{"app":"my app; reboot"}`)
	if err == nil {
		t.Fatalf("expected refusal, got code=%d", code)
	}
	var refused ErrRefused
	if !asRefused(err, &refused) {
		t.Errorf("expected ErrRefused, got %T: %v", err, err)
	}
}

func TestRunHookRejectsBadNamesAndMissing(t *testing.T) {
	// Invalid names (traversal / bad chars) must be refused before any fs access.
	for _, p := range []string{`{"name":"../../etc/passwd"}`, `{"name":"a b"}`, `{"name":""}`, `{}`} {
		_, err, _ := collect(t, "run-hook", p)
		var refused ErrRefused
		if err == nil || !asRefused(err, &refused) {
			t.Errorf("expected refusal for run-hook params %s, got err=%v", p, err)
		}
	}
	// Valid name but no such hook on this box → refused.
	t.Setenv("OUTPOST_HOOKS_DIR", t.TempDir())
	_, err, _ := collect(t, "run-hook", `{"name":"pull"}`)
	if err == nil {
		t.Error("expected refusal when hook file does not exist")
	}
}

func TestRefusedExitCodeMapping(t *testing.T) {
	// The client maps ErrRefused to ExitRefused (126); verify the constant
	// hasn't drifted from the protocol.
	if protocol.ExitRefused != 126 {
		t.Errorf("ExitRefused must be 126, got %d", protocol.ExitRefused)
	}
}

func asRefused(err error, target *ErrRefused) bool {
	r, ok := err.(ErrRefused)
	if ok {
		*target = r
	}
	return ok
}
