package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeConf(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "agent.conf")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadFromFile(t *testing.T) {
	p := writeConf(t, "url=wss://outpost.example.com/connect\nmachine_id=m_1\nkey_path=/tmp/k\n")
	cfg, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ControlPlaneURL != "wss://outpost.example.com/connect" {
		t.Errorf("url = %q", cfg.ControlPlaneURL)
	}
	if cfg.MachineID != "m_1" || cfg.KeyPath != "/tmp/k" {
		t.Errorf("machine/key = %q/%q", cfg.MachineID, cfg.KeyPath)
	}
}

func TestKeyPathDefaultsAlongsideConfig(t *testing.T) {
	p := writeConf(t, "url=wss://x/connect\nmachine_id=m_1\n")
	cfg, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(filepath.Dir(p), "agent.key")
	if cfg.KeyPath != want {
		t.Errorf("default key path = %q, want %q", cfg.KeyPath, want)
	}
}

func TestEnvOverridesFile(t *testing.T) {
	p := writeConf(t, "url=wss://file/connect\nmachine_id=m_file\n")
	t.Setenv("OUTPOST_MACHINE_ID", "m_env")
	cfg, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MachineID != "m_env" {
		t.Errorf("env should override file machine id, got %q", cfg.MachineID)
	}
}

func TestValidationRequiresWssScheme(t *testing.T) {
	t.Setenv("OUTPOST_URL", "http://nope")
	t.Setenv("OUTPOST_MACHINE_ID", "m_1")
	if _, err := Load(""); err == nil {
		t.Fatal("expected scheme validation error")
	}
}

func TestValidationRequiresMachineIDAndURL(t *testing.T) {
	t.Setenv("OUTPOST_URL", "wss://x/connect")
	if _, err := Load(""); err == nil {
		t.Fatal("expected error when machine id is missing (must enroll first)")
	}
}

func TestWriteRoundTrip(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "agent.conf")
	in := Config{ControlPlaneURL: "wss://x/connect", MachineID: "m_w", KeyPath: "/tmp/k"}
	if err := Write(p, in); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("config written with mode %o, want 0600", info.Mode().Perm())
	}
	out, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	if out.MachineID != in.MachineID || out.ControlPlaneURL != in.ControlPlaneURL {
		t.Errorf("round trip mismatch: %+v", out)
	}
}
