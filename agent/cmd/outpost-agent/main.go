// Command outpost-agent is the Outpost agent: a single static binary installed
// on a managed server. It dials OUT to the control plane over wss and executes
// allowlisted actions. It never listens for inbound connections.
//
// Usage:
//
//	outpost-agent add --url wss://host/connect --token oet_...   # first-time enroll
//	outpost-agent [--config /etc/outpost/agent.conf]             # run (default)
//	outpost-agent --version
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/aryanvikash/outpost/agent/internal/actions"
	"github.com/aryanvikash/outpost/agent/internal/client"
	"github.com/aryanvikash/outpost/agent/internal/config"
	"github.com/aryanvikash/outpost/agent/internal/enroll"
	"github.com/aryanvikash/outpost/agent/internal/identity"
)

// version is overridden at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	// Subcommand dispatch: `add` enrolls; anything else runs the agent.
	if len(os.Args) > 1 && os.Args[1] == "add" {
		if err := runAdd(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "enroll failed: %v\n", err)
			os.Exit(1)
		}
		return
	}
	runAgent()
}

// runAdd implements `outpost-agent add`: generate a device keypair, register the
// public key with the control plane using a one-time enroll token, and persist
// the key + config. The private key never leaves this machine.
func runAdd(args []string) error {
	fs := flag.NewFlagSet("add", flag.ExitOnError)
	url := fs.String("url", os.Getenv("OUTPOST_URL"), "control-plane connect URL (wss://host/connect)")
	token := fs.String("token", os.Getenv("OUTPOST_ENROLL_TOKEN"), "one-time enroll token (oet_...)")
	name := fs.String("name", os.Getenv("OUTPOST_NAME"), "machine name (defaults to hostname)")
	configPath := fs.String("config", config.DefaultPath, "where to write the agent config")
	keyPath := fs.String("key", "", "where to write the device private key (default: alongside config)")
	_ = fs.Parse(args)

	if *url == "" || *token == "" {
		return fmt.Errorf("--url and --token are required (or set OUTPOST_URL / OUTPOST_ENROLL_TOKEN)")
	}
	kp := *keyPath
	if kp == "" {
		kp = config.DefaultKeyPath(*configPath)
	}

	endpoint, err := enroll.EndpointFromConnectURL(*url)
	if err != nil {
		return fmt.Errorf("bad --url: %w", err)
	}

	id, err := identity.Generate()
	if err != nil {
		return err
	}
	hostname, _ := os.Hostname()

	machineID, err := enroll.Do(context.Background(), endpoint, *token, enroll.Request{
		PublicKey:    id.PublicKeyBase64(),
		Name:         *name,
		Hostname:     hostname,
		Arch:         runtime.GOARCH,
		AgentVersion: version,
	})
	if err != nil {
		return err
	}

	// Persist the private key first (O_EXCL: never clobber an existing key).
	if err := identity.Save(id, kp); err != nil {
		return fmt.Errorf("write key %s: %w", kp, err)
	}
	if err := config.Write(*configPath, config.Config{
		ControlPlaneURL: *url,
		MachineID:       machineID,
		KeyPath:         kp,
	}); err != nil {
		return fmt.Errorf("write config %s: %w", *configPath, err)
	}

	fmt.Printf("enrolled as %s\n", machineID)
	fmt.Printf("  config: %s\n", *configPath)
	fmt.Printf("  key:    %s (keep this private; it is this device's identity)\n", kp)
	fmt.Printf("start with: outpost-agent --config %s   (or: systemctl enable --now outpost-agent)\n", *configPath)
	return nil
}

func runAgent() {
	configPath := flag.String("config", config.DefaultPath, "path to agent config file")
	showVersion := flag.Bool("version", false, "print version and exit")
	logJSON := flag.Bool("log-json", false, "emit structured JSON logs")
	flag.Parse()

	if *showVersion {
		fmt.Printf("outpost-agent %s\n", version)
		fmt.Printf("actions: %v\n", actions.Names())
		return
	}

	var handler slog.Handler
	if *logJSON {
		handler = slog.NewJSONHandler(os.Stderr, nil)
	} else {
		handler = slog.NewTextHandler(os.Stderr, nil)
	}
	log := slog.New(handler)

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Error("config error", "err", err)
		os.Exit(1)
	}
	id, err := identity.Load(cfg.KeyPath)
	if err != nil {
		log.Error("device key error", "err", err, "keyPath", cfg.KeyPath)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Info("starting outpost-agent",
		"version", version,
		"url", cfg.ControlPlaneURL,
		"machineId", cfg.MachineID,
		"actions", actions.Names(),
	)

	c := client.New(cfg, id, version, log)
	if err := c.Run(ctx); err != nil && ctx.Err() == nil {
		log.Error("agent stopped", "err", err)
		os.Exit(1)
	}
	log.Info("shutdown complete")
}
