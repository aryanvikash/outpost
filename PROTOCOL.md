# Outpost Wire Protocol

**Protocol version: `1`**

This document is the language-neutral, versioned contract between an Outpost
**agent** (the client) and the Outpost **API** (the WebSocket server, a
Cloudflare Durable Object). It is the source of truth: the Go types in
`agent/internal/protocol` and the TypeScript types in `api/src/protocol.ts`
mirror this document and MUST be kept in sync.

Anyone may implement an agent in any language by conforming to this spec.

---

## 1. Transport

- **WebSocket Secure (`wss://`)** only. Plaintext `ws://` is permitted **only** for
  local development against `wrangler dev`.
- The agent always **dials out**. The API is always the server. The agent
  never listens for inbound connections. This is the core security property: managed
  servers can keep every inbound port closed.
- Each agent holds **exactly one** live socket to the API at a time.
- Every application message is a single **JSON text frame** (UTF-8). Binary frames are
  reserved and currently unused.
- **Maximum message size: 1 MiB (1048576 bytes).** Senders MUST chunk payloads (notably
  `log` chunks) to stay under this limit. A receiver MAY close the connection with code
  `1009` (message too big) if exceeded.

## 2. Identity, enrollment & authentication

Each device has its own **Ed25519 keypair, generated on the device**. The private key
never leaves the machine; the API stores only the public key. No shared secret
is ever transmitted on connect.

### 2.1 Enrollment (one-time)

A device registers its public key once, authorized by a short-lived **enroll token**
(`oet_…`) minted by an admin:

```
POST /enroll HTTP/1.1
Authorization: Bearer <enroll-token>
Content-Type: application/json

{ "publicKey": "<base64 raw Ed25519, 32 bytes>", "name": "...", "hostname": "...",
  "arch": "amd64", "agentVersion": "0.1.0" }
```

- The API verifies the enroll token (SHA-256 hashed lookup, not expired, uses
  remaining), creates the machine, stores the public key, and **spends one use** of the
  token. Response: `201 { "machineId": "m_…" }`.
- One-time tokens (`uses: 1`) are consumed on first success; reusable fleet keys
  (`uses: N`) provision many devices, each getting its own machine id and keypair.
- The enroll token is the **only** secret that crosses the wire, and only this once.

### 2.2 Connect authentication (every connection)

Authentication happens **on the HTTP upgrade request** via a short-lived JWT the device
signs with its private key:

```
GET /connect HTTP/1.1
Upgrade: websocket
Authorization: Bearer <device-signed JWT>
X-Outpost-Machine-Id: <machineId>
X-Outpost-Agent-Version: <semver>
```

The JWT is **EdDSA** (Ed25519):

```
header  { "alg": "EdDSA", "typ": "JWT", "kid": "<machineId>" }
payload { "iss": "<machineId>", "iat": <unix-sec>, "exp": <iat+~60s>,
          "aud": "outpost-connect" }
```

- The server reads `kid`/`iss` to select the machine's stored public key, then verifies
  the signature. The `kid` is untrusted input — only a holder of the private key can
  produce a valid signature for that machine.
- Claims are validated: `aud == "outpost-connect"`, not expired (±60s skew), lifetime
  ≤ 300s. Replay is bounded by the short `exp`.
- On success the upgrade returns `101 Switching Protocols` and the socket is routed to
  that machine's Durable Object.
- On failure: `401` (missing/malformed/expired/bad-signature/unknown machine) or `403`
  (revoked). The server does **not** upgrade.

After the socket opens, the agent SHOULD send a `hello` message as its first frame to
announce capabilities. No credential is repeated in `hello`; identity was proven on the
upgrade. A new connection for a machine replaces any existing one (close code `4002`).

## 3. Message envelope

Every message is a JSON object with at least:

| field     | type   | required | notes                                     |
|-----------|--------|----------|-------------------------------------------|
| `type`    | string | yes      | message type (see below)                  |
| `version` | number | yes      | protocol version; currently `1`           |

Unknown top-level fields MUST be ignored by receivers (forward compatibility).

---

## 4. Agent → API messages

### `hello`
Sent once, immediately after the socket opens.

```json
{
  "type": "hello",
  "version": 1,
  "machineId": "m_abc123",
  "agentVersion": "0.1.0",
  "actions": ["healthcheck", "deploy", "restart"]
}
```

- `actions` is the allowlist the agent supports, so the API can refuse to
  enqueue actions an agent can't run.
- No credential appears in `hello`; the device proved its identity by signing the
  connect JWT (§2.2).

### `heartbeat`
Periodic liveness ping. **Default interval: 30 seconds.** The API marks a
machine offline if no heartbeat (or other message) arrives within **2.5×** the interval.

```json
{
  "type": "heartbeat",
  "version": 1,
  "ts": 1719446400000,
  "stats": {
    "uptimeSec": 12345,
    "load1": 0.12,
    "memUsedMb": 512,
    "memTotalMb": 2048
  }
}
```

`stats` is best-effort; fields may be omitted if unavailable.

### `log`
Streamed output during a running job. Chunks for a given `jobId`+`stream` are ordered by
a monotonically increasing `seq` starting at `0`.

```json
{
  "type": "log",
  "version": 1,
  "jobId": "j_xyz",
  "stream": "stdout",
  "seq": 0,
  "chunk": "Cloning into 'app'...\n"
}
```

- `stream` is `"stdout"` or `"stderr"`.
- `chunk` is a UTF-8 string. Keep each message well under the 1 MiB cap.

### `result`
Terminal message for a job. Exactly one `result` per dispatched job.

```json
{
  "type": "result",
  "version": 1,
  "jobId": "j_xyz",
  "exitCode": 0,
  "finishedAt": 1719446405000,
  "error": null
}
```

- `exitCode` is the process exit code, or a synthetic code for agent-level failures:
  - `124` — timed out (mirrors GNU `timeout`).
  - `125` — agent could not start the action (e.g. unknown action, invalid params).
  - `126` — action refused (allowlist/validation rejection).
- `error` is an optional human-readable string set when `exitCode != 0` for agent-level
  failures.

### `ack`
Optional acknowledgement that a `job` was received and accepted for execution.

```json
{ "type": "ack", "version": 1, "jobId": "j_xyz" }
```

---

## 5. API → agent messages

### `job`
Pushes a unit of work. **The API never sends a raw command.** It sends a named
`action` from the allowlist plus a validated, constrained `params` object. The mapping
from action name to concrete commands lives entirely in the agent.

```json
{
  "type": "job",
  "version": 1,
  "jobId": "j_xyz",
  "action": "deploy",
  "params": { "branch": "main" },
  "timeoutSec": 300
}
```

- `action` MUST be a member of the agent's allowlist. If not, the agent replies with a
  `result` whose `exitCode` is `126` and does not execute anything.
- `timeoutSec` is enforced by the agent. **Default: 300.** On expiry the agent kills the
  process group and returns `exitCode` `124`.

### `cancel`
Requests cancellation of an in-flight job.

```json
{ "type": "cancel", "version": 1, "jobId": "j_xyz" }
```

The agent SHOULD kill the running process group and emit a `result` with `exitCode`
`130` (terminated). If the job is unknown or already finished, the agent ignores it.

### `welcome`
Optional server acknowledgement of `hello`, echoing negotiated parameters.

```json
{
  "type": "welcome",
  "version": 1,
  "heartbeatSec": 30,
  "serverTime": 1719446400000
}
```

---

## 6. Job lifecycle & redelivery semantics

```
queued ──dispatch──► dispatched ──ack──► running ──result──► succeeded | failed
   │                      │                                       
   │                      └── socket drops before result ──► interrupted
   └── agent offline at enqueue: stays queued until next connect
```

- **queued** — accepted by the API; agent offline or not yet pushed.
- **dispatched** — `job` frame sent to the agent.
- **running** — agent sent `ack` (or first `log`).
- **succeeded / failed** — `result` received; `failed` when `exitCode != 0`.
- **interrupted** — the socket closed after dispatch but before a `result` arrived.

**Redelivery:** an `interrupted` job is **not** silently re-run. It is only redelivered
on reconnect if its action is declared **idempotent** (see §7). Otherwise it terminates
in the `interrupted` state and requires an explicit re-enqueue by an operator.

## 7. Actions (allowlist)

Actions are a closed, vetted set. Adding one is a code change reviewed in a PR — never a
runtime/config capability.

| action        | idempotent | params                                  | summary                                  |
|---------------|------------|-----------------------------------------|------------------------------------------|
| `healthcheck` | yes        | `{}`                                    | returns host info; the e2e smoke test    |
| `deploy`      | no         | `{ branch?: string }`                   | host deploy hook if present, else `git pull` + `npm ci` + `pm2 reload` |
| `restart`     | yes        | `{ app?: string }`                      | `pm2 reload <app>`                        |
| `run-hook`    | no         | `{ name: string }`                      | runs a host-defined hook script by name  |

**Host hooks (custom commands).** An operator may place scripts in the agent's
hooks dir — `$OUTPOST_HOOKS_DIR`, defaulting to `~/.config/outpost/hooks/` for a
rootless/user install (no sudo needed) or `/etc/outpost/hooks/` for the systemd
system service. `run-hook` runs `<dir>/<name>`; `deploy` runs `<dir>/deploy` if it
exists (falling back to the built-in PM2 flow). This is how arbitrary stacks
(pip/supervisor, docker-compose, …) are supported **without ever sending a command
string over the wire** — the API sends only the hook *name* (validated
`^[a-z0-9][a-z0-9_-]{0,63}$`); the commands live on the host. The **only** hard
requirement is that the file is **not group/world-writable** (so other users can't
tamper with it); the execute bit is optional — a non-executable script is run via
`sh`, so dropping a file in place works without `chmod +x`. Validated params are
passed as env vars (e.g. `OUTPOST_BRANCH`). In `hello` the agent reports the deploy
mode, the runnable `hooks`, and `hookIssues` — files that look like intended hooks
but can't run (wrong name, group/world-writable), each `{ name, reason }`, so the
UI can surface the problem instead of silently ignoring the file.

**Param validation is mandatory and lives in the agent.** Example constraints:

- `branch` — matches `^[A-Za-z0-9._/-]{1,255}$`, no leading `-`, no `..` path segments.
- `app` — matches `^[A-Za-z0-9._-]{1,64}$`.

Any param that fails validation ⇒ `result` with `exitCode` `126` and an `error` string.
Unknown params are ignored. The agent passes validated params to commands via argv (never
through a shell), so shell metacharacters are inert.

## 8. Versioning rules

- `version` is an integer. This document defines `1`.
- **Backward-compatible** changes (new optional fields, new message types that old peers
  ignore, new actions) do **not** bump the version.
- **Breaking** changes (renaming/removing a field, changing semantics) bump `version`.
  A peer that receives a `version` it cannot satisfy MUST refuse: the API
  closes with code `1002` (protocol error); the agent logs and reconnects, backing off.
- Both sides advertise their max supported version implicitly via the `version` they
  send. Negotiation beyond "must match major" is out of scope for v1.

## 9. Close codes

| code   | meaning                          | who sends |
|--------|----------------------------------|-----------|
| `1000` | normal shutdown                  | either    |
| `1002` | protocol error / version mismatch| either    |
| `1008` | policy violation (auth)          | server    |
| `1009` | message too big                  | either    |
| `4001` | token revoked mid-session        | server    |
| `4002` | replaced by a newer connection   | server    |

On any unexpected close the agent reconnects with exponential backoff + jitter (see the
agent implementation). The API keeps the machine's job queue durable across
disconnects.
