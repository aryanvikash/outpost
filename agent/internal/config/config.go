// Package config loads the agent's API URL, machine id, and device
// key path from a file (mode 0600) and/or environment variables.
package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DefaultPath is the conventional config location for the systemd unit.
const DefaultPath = "/etc/outpost/agent.conf"

// Config holds everything the agent needs to connect.
type Config struct {
	// ControlPlaneURL is the wss:// (or ws:// for dev) endpoint, e.g.
	// wss://outpost.example.com/connect
	ControlPlaneURL string
	// MachineID is the device's id, assigned at enrollment.
	MachineID string
	// KeyPath is the path to the device private key (mode 0600).
	KeyPath string
}

// Load reads config from the given file (if it exists) and overlays environment
// variables (OUTPOST_URL, OUTPOST_MACHINE_ID, OUTPOST_KEY_PATH), which take
// precedence. A path of "" skips file loading.
func Load(path string) (Config, error) {
	var c Config

	if path != "" {
		if err := c.loadFile(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return c, err
		}
	}

	if v := os.Getenv("OUTPOST_URL"); v != "" {
		c.ControlPlaneURL = v
	}
	if v := os.Getenv("OUTPOST_MACHINE_ID"); v != "" {
		c.MachineID = v
	}
	if v := os.Getenv("OUTPOST_KEY_PATH"); v != "" {
		c.KeyPath = v
	}

	if c.KeyPath == "" {
		c.KeyPath = DefaultKeyPath(path)
	}

	if err := c.validate(); err != nil {
		return c, err
	}
	return c, nil
}

// DefaultKeyPath returns agent.key alongside the config file, or the system
// default if no config path is known.
func DefaultKeyPath(configPath string) string {
	if configPath != "" {
		return filepath.Join(filepath.Dir(configPath), "agent.key")
	}
	return "/etc/outpost/agent.key"
}

func (c *Config) loadFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		switch strings.ToUpper(key) {
		case "URL", "OUTPOST_URL", "CONTROL_PLANE_URL":
			c.ControlPlaneURL = val
		case "MACHINE_ID", "OUTPOST_MACHINE_ID":
			c.MachineID = val
		case "KEY_PATH", "OUTPOST_KEY_PATH":
			c.KeyPath = val
		}
	}
	return sc.Err()
}

func (c *Config) validate() error {
	if c.ControlPlaneURL == "" {
		return errors.New("API URL is required (set OUTPOST_URL or url= in config)")
	}
	if !strings.HasPrefix(c.ControlPlaneURL, "wss://") &&
		!strings.HasPrefix(c.ControlPlaneURL, "ws://") {
		return fmt.Errorf("API URL must start with wss:// (or ws:// for dev), got %q", c.ControlPlaneURL)
	}
	if c.MachineID == "" {
		return errors.New("machine id is required — run `outpost-agent add` to enroll this device first")
	}
	return nil
}

// Write persists the config to path with mode 0600 (overwriting).
func Write(path string, c Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("# Outpost agent configuration (written by `outpost-agent add`).\n")
	fmt.Fprintf(&b, "url=%s\n", c.ControlPlaneURL)
	fmt.Fprintf(&b, "machine_id=%s\n", c.MachineID)
	fmt.Fprintf(&b, "key_path=%s\n", c.KeyPath)
	return os.WriteFile(path, []byte(b.String()), 0o600)
}
