# Security

Outpost executes commands on your servers. Trust is the product. This document
states the threat model and how to report vulnerabilities.

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories
("Report a vulnerability") on this repository, or by email to the maintainers.
Do **not** open a public issue for an unpatched vulnerability. We aim to
acknowledge within 72 hours.

## Design properties

1. **Outbound-only agents.** The agent dials out; it never listens. Managed
   servers need no inbound ports (including SSH/22). This shrinks the network
   attack surface to "can the box make an outbound TLS connection."
2. **Device-held keys, no shared connect secret.** Each agent generates its own
   Ed25519 keypair on the box; the private key never leaves it. The control plane
   stores only the public key and verifies a short-lived (~60s) device-signed JWT
   on every connect. A control-plane/D1 leak exposes no usable credential. See
   [`ENROLLMENT.md`](./ENROLLMENT.md). First registration is authorized by a
   short-lived, hashed-at-rest **enroll token** — the only secret that ever
   crosses the wire, and only once.
3. **No arbitrary command execution.** The control plane sends a *named action*
   from a closed allowlist plus a *validated, constrained params object* — never
   a command string. The action→command mapping lives only in the agent
   (`agent/internal/actions`). Adding or changing an action is a code change,
   reviewed in a PR.
4. **Params are validated and passed via argv.** Validated params are never
   interpolated into a shell; commands are executed with an explicit argument
   vector, so shell metacharacters are inert. Inputs like `branch` are matched
   against a strict pattern and rejected on `..`, leading `-` (option
   injection), etc.
5. **Key hygiene.** The device private key lives at `key_path` (default
   `/etc/outpost/agent.key`) with mode `0600`; the agent refuses to load it if
   it's group/world-readable, and refuses to overwrite an existing key on
   enrollment. Devices are revocable (`/api/machines/:id/revoke`) and rotatable
   (revoke + re-`add`). Enroll tokens are random, hashed (SHA-256) at rest,
   one-time or use-limited, and expiring.
6. **Separate admin credential.** The admin API authenticates with `ADMIN_TOKEN`,
   which is distinct from device keys and enroll tokens. Admin token comparison
   is constant-time.
7. **Least privilege on the host.** The agent runs as a non-root `outpost` user
   under a hardened systemd unit (`NoNewPrivileges`, `ProtectSystem=strict`,
   etc.). Deploy actions get only a narrow `sudoers` grant for the specific
   commands they run — see `packaging/sudoers/outpost-agent`.
8. **TLS pinning (optional).** Set `OUTPOST_TLS_PIN` to the base64 SHA-256 of the
   control-plane certificate's SubjectPublicKeyInfo to pin it and defend against
   a mis-issued/compromised CA.
9. **Signed releases.** Release binaries ship with SHA-256 checksums; the
   checksum file is signed with cosign/Sigstore (keyless). The installer verifies
   the checksum and supports pinning a version (`OUTPOST_VERSION`).

## Threat model

**The control plane is the trust anchor.** Whoever controls the Worker can issue
jobs to every connected agent. Therefore:

- The **allowlist is the blast-radius limiter.** Even with a fully compromised
  control plane, an attacker can only invoke the vetted actions with validated
  params — not run arbitrary commands. Keep the allowlist minimal and audit every
  addition.
- Protect `ADMIN_TOKEN` as a high-value secret. Store it as a Worker secret
  (`wrangler secret put`), never in source or `[vars]`.
- Restrict who can deploy/modify the Worker (Cloudflare account access is
  effectively root over your fleet's allowlisted actions).

**In scope:** device key theft, enroll-token theft/misuse, admin token theft,
action/param injection, unauthorized job dispatch, downgrade/replay on the wire,
supply-chain integrity of released binaries.

**Out of scope (by design, for now):** a compromised host's own integrity (if an
attacker already has root on the box, Outpost is not your control); full config
management; multi-tenant isolation (single-tenant control plane today).

## GitHub App triggers (Phase 6)

- Incoming webhook deliveries are authenticated by **HMAC-SHA256**
  (`X-Hub-Signature-256`) against `GITHUB_WEBHOOK_SECRET`; unsigned or mismatched
  deliveries are rejected with `401`. The webhook endpoint requires no admin
  token because the signature *is* the credential.
- A push only triggers a job if an explicit `repo + branch → machine` **binding**
  exists. There is no implicit/global deploy. Bindings are created via the
  admin API and audited.
- For `deploy`, the pushed branch is authoritative and is still run through the
  same strict branch validation as any other enqueue.
- Commit-status feedback uses short-lived GitHub **installation tokens** minted
  from the App private key (`GITHUB_APP_PRIVATE_KEY`, stored as a Worker secret);
  no long-lived user token is stored. Feedback is best-effort and never affects
  job execution.

## Job redelivery safety

A job dispatched but never acknowledged with a `result` before a disconnect is
marked **interrupted**. It is **not** silently re-run unless its action is
explicitly marked idempotent (e.g. `healthcheck`, `restart`). Non-idempotent
actions like `deploy` require an explicit operator re-enqueue. This prevents a
flaky network from triggering duplicate deploys.
