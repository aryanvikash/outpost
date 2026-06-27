# Outpost Agent

The **agent** is a single static **Go** binary installed on each managed server.
It dials **outbound** over WebSocket Secure to the [control plane](../control-plane),
executes jobs from a **fixed allowlist of named actions** (never arbitrary shell),
streams logs back, and reports an exit status. It never listens for inbound
connections — so the managed box can keep every inbound port closed, including 22.

> Module: `github.com/aryanvikash/outpost/agent` · Go 1.23 · one dependency
> (`github.com/coder/websocket`).

## Install (the normal path)

```sh
curl -fsSL https://raw.githubusercontent.com/aryanvikash/outpost/main/install.sh | \
  sudo OUTPOST_URL=wss://<your-worker>/connect OUTPOST_ENROLL_TOKEN=oet_… sh
```

The installer detects OS/arch, downloads the matching release binary, verifies its
SHA-256 checksum, installs the systemd unit, runs the agent **as a real login user**
(so deploy hooks can reach that user's app dirs, git, node, pm2), enrolls the
device, and starts the service. See the [root README](../README.md) for the full
flow and how to close inbound ports.

## Build from source

```sh
cd agent
go build -o outpost-agent ./cmd/outpost-agent

# cross-compile for a Linux server from any host:
GOOS=linux GOARCH=amd64 go build -o outpost-agent ./cmd/outpost-agent
GOOS=linux GOARCH=arm64 go build -o outpost-agent ./cmd/outpost-agent

# embed a version (release builds set this via -ldflags):
go build -ldflags "-X main.version=v0.1.2" ./cmd/outpost-agent
```

## Commands

```sh
outpost-agent add --url wss://host/connect --token oet_…   # first-time enroll
outpost-agent                                              # run the agent (default)
outpost-agent hook edit <name>                            # create/edit a host hook (no sudo, no chmod)
outpost-agent hook ls                                     # list runnable hooks + problems
outpost-agent hook path                                   # print the hooks dir
outpost-agent update [--version vX.Y.Z]                   # self-update + restart
outpost-agent uninstall [--yes] [--remove-user]          # stop + remove
outpost-agent --version
```

`add` generates an Ed25519 keypair locally, registers the **public** key with a
one-time enroll token, and writes the private key + config. The private key never
leaves the machine.

## Configuration

The agent reads `/etc/outpost/agent.conf` (override with `--config`). Environment
variables take precedence over the file.

| variable | default | purpose |
|----------|---------|---------|
| `OUTPOST_URL` | — (required) | control-plane connect URL (`wss://host/connect`) |
| `OUTPOST_MACHINE_ID` | from config | this device's machine id (`m_…`) |
| `OUTPOST_KEY_PATH` | next to config | path to the device private key |
| `OUTPOST_APP_DIR` | `/srv/app` | git working tree for the built-in deploy |
| `OUTPOST_PM2_TARGET` | `ecosystem.config.js` | pm2 app name / ecosystem file |
| `OUTPOST_GIT_REMOTE` | `origin` | git remote for the built-in deploy |
| `OUTPOST_HOOKS_DIR` | `~/.config/outpost/hooks` (user) or `/etc/outpost/hooks` (system) | where host hooks live |

Deploy targets are **agent-side config** — they are never supplied over the wire.
The only operator-supplied deploy input is the branch, which is strictly validated.

## Actions (the allowlist)

| action | idempotent | params | what it does |
|--------|-----------|--------|--------------|
| `healthcheck` | yes | `{}` | returns host info (the e2e smoke test) |
| `deploy` | no | `{ branch?: string }` | host `deploy` hook if present, else `git pull` + `npm ci` + `pm2 reload` |
| `restart` | yes | `{ app?: string }` | `pm2 reload <app>` |
| `run-hook` | no | `{ name: string }` | runs a host-defined hook script by name |

Adding an action is a **code change** in `internal/actions`, reviewed in a PR —
never a runtime capability. Params are validated in the agent and passed via argv
(never through a shell), so shell metacharacters are inert.

## Custom commands (host hooks)

For any stack (Python/supervisor, docker-compose, a `pull`/`migrate` step, …),
drop a script in the hooks dir and run it by name — **no command string ever
crosses the wire**, only the validated hook *name*.

```sh
outpost-agent hook edit deploy      # creates a template + opens $EDITOR; no sudo, no chmod
```

- `deploy` runs `<hooks>/deploy` if present (else the built-in PM2 flow).
- `run-hook` runs any `<hooks>/<name>` — these surface in the dashboard as
  one-click **Custom commands** buttons.
- The only hard requirement is that the file is **not group/world-writable** (so
  another user on the box can't tamper with it). The execute bit is optional — a
  non-executable script runs via `sh`, so dropping a file in place just works.
- Validated params arrive as env vars (`OUTPOST_BRANCH`, …).
- Files that look like intended hooks but can't run (bad name, world-writable)
  are reported in `hello` as `hookIssues`, so the dashboard surfaces the problem
  instead of silently ignoring them.

## Identity & security

- Each device generates its own **Ed25519 keypair on the box**; the control plane
  stores only the public key. The private key (`0600`) never leaves the machine.
- Enrollment is authorized once by a short-lived enroll token (`oet_…`).
- Every connection authenticates on the HTTP upgrade with a short-lived **EdDSA
  JWT** the device signs — no shared secret crosses the wire after enrollment.

See [`../ENROLLMENT.md`](../ENROLLMENT.md) and [`../SECURITY.md`](../SECURITY.md).

## Source layout

```
cmd/outpost-agent/    main (subcommand dispatch), update (self-update)
internal/actions/     the allowlist: healthcheck, deploy, restart, run-hook, hooks, validation
internal/client/      wss client: connect, hello, heartbeat, job loop, reconnect/backoff
internal/config/      config file + env loading
internal/enroll/      one-time enroll request
internal/identity/    Ed25519 keypair generate/load/save
internal/protocol/    Go types mirroring PROTOCOL.md (wire contract)
```

The wire format is the language-neutral source of truth in
[`../PROTOCOL.md`](../PROTOCOL.md) — `internal/protocol` must stay in sync with it.

## Development

```sh
cd agent
go test ./...
go vet ./...
```

Defaults: heartbeat **30s**, job timeout **300s** (override per-job with
`timeoutSec`). On timeout the agent kills the process group and returns exit `124`.
