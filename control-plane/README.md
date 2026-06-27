# Outpost Control Plane

The **control plane** is the server side of Outpost, running entirely on
**Cloudflare**: a **Worker** (the front door, built with [Hono](https://hono.dev))
+ **Durable Objects** (one per managed machine) + **D1** (fleet-wide registry, job
history, audit log). It terminates the agents' outbound WebSocket connections,
pushes jobs down them, collects logs/results, and exposes an admin API.

```
 Worker (front door, Hono)              Durable Object (ONE per machine)        D1 (fleet-wide)
 • terminates wss, validates JWT   ──►  • IS the WebSocket server (Hibernation) ──►  • machines + hashed tokens
 • routes to the machine's DO           • per-machine job queue + state (SQLite)     • job history + audit log
 • admin API (Bearer / session JWT)     • pushes jobs, collects logs/results
```

The agent always **dials out**; the Durable Object is the WebSocket **server**.
That direction is the core security property — see [`../SECURITY.md`](../SECURITY.md).

## Deploy

```sh
cd control-plane
npm install
npm run deploy     # wrapper around ./deploy.sh — idempotent, re-run for every deploy
```

`npm run deploy` does the one-time setup on first run (login → create D1 → patch
`wrangler.toml` → migrate → deploy → generate & set `ADMIN_TOKEN`, shown once),
then on later runs just migrates + deploys. Other entry points:

```sh
npm run dev          # local: applies local migrations, writes a throwaway .dev.vars,
                     # starts `wrangler dev` on http://localhost:8787
npm run setup        # one-time setup only
npm run deploy:raw   # bare `wrangler deploy` (no migrate/setup)
npm run migrate:remote   # apply D1 migrations to the deployed DB
```

### Manual first-time setup (what `deploy.sh setup` automates)

```sh
wrangler d1 create outpost        # paste database_id into wrangler.toml
wrangler secret put ADMIN_TOKEN   # the master admin credential
wrangler d1 migrations apply outpost --remote
wrangler deploy
```

## Configuration

Non-secret config lives in `wrangler.toml [vars]`; secrets are set with
`wrangler secret put`.

| name | kind | default | purpose |
|------|------|---------|---------|
| `ADMIN_TOKEN` | secret | — (required) | master admin credential for the API |
| `ADMIN_PASSWORD` | secret | falls back to `ADMIN_TOKEN` | dashboard login password |
| `ADMIN_JWT_SECRET` | secret | falls back to `ADMIN_TOKEN` | signs the dashboard's session JWT |
| `ADMIN_UI_ORIGIN` | var | `*` | lock CORS to the dashboard's origin |
| `HEARTBEAT_SEC` | var | `30` | agent heartbeat interval |
| `DEFAULT_JOB_TIMEOUT_SEC` | var | `300` | default per-job timeout |
| `GITHUB_WEBHOOK_SECRET` | secret | — | verify GitHub App webhook signatures |
| `GITHUB_APP_PRIVATE_KEY` | secret | — | PKCS#8 PEM, for commit-status feedback |
| `GITHUB_APP_ID` | var | — | the GitHub App id |

The GitHub vars are optional — without them, auto-deploy on push (Phase 6) is
simply inactive. See the [root README](../README.md#auto-deploy-on-push-github-app).

## API

All `/api/*` admin routes require `Authorization: Bearer $ADMIN_TOKEN` (or a
session JWT from `/api/admin/login`). Device-facing routes use their own auth.

### Admin

| method | path | purpose |
|--------|------|---------|
| POST | `/api/admin/login` | exchange admin password → session JWT |
| POST | `/api/enroll-tokens` | mint an enroll token (one-time or fleet key) |
| GET | `/api/enroll-tokens` | list enroll tokens |
| GET | `/api/machines` | list machines + online status, hooks, deploy mode |
| POST | `/api/machines/:id/rename` | rename a machine |
| POST | `/api/machines/:id/revoke` | revoke a device |
| GET | `/api/machines/:id/jobs` | list a machine's jobs |
| POST | `/api/machines/:id/jobs` | enqueue a job `{ action, params }` |
| GET | `/api/jobs/:id` | job status + result |
| GET | `/api/jobs/:id/logs` | streamed logs for a job |
| GET | `/api/jobs/:id/tail` | live-tail a job over WebSocket |
| POST | `/api/jobs/:id/cancel` | request cancellation |
| POST | `/api/bindings` | bind `repo + branch → machine/action` |
| GET | `/api/bindings` | list repo→machine bindings |
| DELETE | `/api/bindings/:id` | remove a binding |
| GET | `/api/webhooks/deliveries` | recent GitHub webhook deliveries |

### Device-facing & webhooks

| method | path | auth |
|--------|------|------|
| POST | `/enroll` | **enroll token** (`oet_…`) — registers a device's public key |
| GET | `/connect` | **device-signed EdDSA JWT** — opens the agent WebSocket |
| POST | `/webhooks/github` | **GitHub webhook signature** (HMAC) |

The admin token is never used on device routes, and device credentials are never
used on admin routes.

## Auth model

- **Admin** — a master `ADMIN_TOKEN` (for `curl`/CI), or a short-lived session JWT
  (HS256, ~12h) the dashboard gets from `/api/admin/login`. The browser never holds
  the master token. See [`admin-auth.ts`](./src/admin-auth.ts).
- **Devices** — each holds its own Ed25519 key; the control plane stores only the
  public key and verifies a per-connect signature (`kid`/`iss` select the key).
  A D1 leak exposes no usable device credential. See [`device-auth.ts`](./src/device-auth.ts).
- **Enroll tokens** — short-lived `oet_…`, stored hashed, consumed on use. The
  only secret that ever crosses the wire, and only once.

## Migrations

D1 schema lives in [`migrations/`](./migrations) (numbered SQL). Apply locally with
`npm run migrate:local`, remotely with `npm run migrate:remote` (or just
`npm run deploy`, which migrates first).

## Source layout

```
src/worker.ts        Hono app: admin API + device routes, mounts the DO
src/machine-do.ts    MachineDO — the per-machine WebSocket server + job queue (SQLite)
src/db/index.ts      D1 access layer (machines, jobs, logs, audit)
src/protocol.ts      TS types mirroring PROTOCOL.md (wire contract)
src/admin-auth.ts    admin token + session-JWT verification
src/device-auth.ts   device connect-JWT (EdDSA) verification
src/enqueue.ts       job enqueue + validation
src/actions.ts       action allowlist + param schemas (server side)
src/github-app.ts    GitHub App JWT, commit statuses
src/webhooks.ts      GitHub push webhook → enqueue bound deploys
src/crypto.ts        hashing/signing helpers
src/env.ts           typed env + feature flags
migrations/          D1 schema (numbered SQL)
```

`src/protocol.ts` must stay in sync with the language-neutral
[`../PROTOCOL.md`](../PROTOCOL.md).

## Development

```sh
cd control-plane
npm run typecheck      # tsc --noEmit
npm test               # vitest (uses @cloudflare/vitest-pool-workers)
npm run test:watch
```
