# Device Identity & Enrollment

How an Outpost agent proves who it is — and how it gets that identity in the
first place. This is the authoritative description of the auth model; the wire
details are in [`PROTOCOL.md`](./PROTOCOL.md) §2.

## TL;DR

- Each device has its **own Ed25519 keypair, generated on the device**. The
  **private key never leaves the machine.** The API stores only the
  **public key**.
- First-time registration (`outpost-agent add`) is authorized by a short-lived,
  one-time **enroll token** from the dashboard/admin API. That token is the only
  secret that ever crosses the wire — and only once.
- On **every** connection the agent signs a ~60-second JWT with its private key;
  the API verifies it against the stored public key. No shared secret
  is transmitted on connect, ever.
- A D1/API leak exposes only public keys, which are useless to an
  attacker.

## The two kinds of credential

| | Enroll token (`oet_…`) | Device keypair |
|---|---|---|
| Purpose | authorize first registration | prove identity on every connect |
| Lifetime | short (minutes), 1 use by default | long-lived (the device's identity) |
| Where it lives | dashboard → operator → `add` once | private key stays on the device (`/etc/outpost/agent.key`, `0600`) |
| What we store | SHA-256 hash | the public key only |
| If leaked | can register a bogus device until it expires/used | public key alone can't authenticate |

## Full lifecycle

```
 ┌─ Admin ─────────────┐      ┌─ Device (outpost-agent add) ──────────┐      ┌─ API ─┐
 │ POST /api/enroll-   │      │ 1. generate Ed25519 keypair (local)   │      │                 │
 │   tokens            │─────▶│ 2. POST /enroll                       │─────▶│ verify token,   │
 │ → oet_abc (1 use,   │ copy │    Authorization: Bearer oet_abc      │      │ store PUBLIC    │
 │   60 min)           │      │    { publicKey, hostname, arch }      │      │ key, spend 1    │
 └─────────────────────┘      │ 3. ← { machineId: m_xyz }             │◀─────│ use → m_xyz     │
                              │ 4. write agent.key (0600) + agent.conf │      └─────────────────┘
                              └───────────────────────────────────────┘
                                              │
                   every connect (and reconnect) thereafter:
                                              ▼
   GET /connect  Authorization: Bearer <JWT signed by agent.key, exp ~60s>
                 → API loads m_xyz's public key, verifies signature,
                   checks aud/exp, routes the socket to the machine's DO.
```

## Step by step

### 1. Admin mints an enroll token
```sh
curl -X POST https://<worker>/api/enroll-tokens \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"label":"web tier","uses":1,"expiresInMinutes":60}'
# → { "id":"et_…", "token":"oet_…", "uses":1, "expiresAt":… }   # token shown once
```
- `uses: 1` → one-time (one machine). Use a larger `uses` for a **reusable fleet
  key** to bake into an AMI / cloud-init and onboard many machines, each of which
  still gets its own unique keypair and machine id.
- `expiresInMinutes` bounds the window the bootstrap secret is valid.

### 2. Device self-enrolls
```sh
outpost-agent add --url wss://<worker>/connect --token oet_…
# or non-interactively:
OUTPOST_URL=wss://<worker>/connect OUTPOST_ENROLL_TOKEN=oet_… outpost-agent add
```
What `add` does, in order:
1. Generates an Ed25519 keypair **in memory on the device**.
2. `POST /enroll` with the **public** key + hostname/arch (Bearer = enroll token).
3. Receives `machineId`.
4. Writes the **private** key to `/etc/outpost/agent.key` (`0600`, `O_EXCL` so it
   never clobbers an existing identity).
5. Writes `/etc/outpost/agent.conf` (`url`, `machine_id`, `key_path`).

The enroll token is now spent. The private key has never left the box.

### 3. Agent connects (now and on every reconnect)
The running agent signs a fresh JWT per connection:
```
header  { "alg":"EdDSA", "typ":"JWT", "kid":"m_xyz" }
payload { "iss":"m_xyz", "iat":…, "exp":…+60, "aud":"outpost-connect" }
```
sent as `Authorization: Bearer <jwt>` on the `wss://…/connect` upgrade. The
API (`device-auth.ts`):
1. reads `kid` to find machine `m_xyz` and its stored public key,
2. verifies the Ed25519 signature over the JWT,
3. checks `aud`, expiry (±60s skew), max lifetime (≤300s), and that the device
   isn't revoked,
4. routes the socket to the machine's Durable Object.

## Why device-generated (not server-held) keys

If the API generated keypairs and stored the private keys, a D1 leak
would let an attacker impersonate every device — the same blast radius as bearer
tokens. Generating on the device and storing only the public key means the secret
that authenticates a machine **exists in exactly one place: that machine.** This
is the whole point of going asymmetric, and it's why `add` generates locally.

## Operations

- **Revoke a device:** `POST /api/machines/:id/revoke`. Its next connect (and any
  reconnect) is refused with `403`; existing socket is dropped by the liveness path.
- **Rotate a device key:** revoke, then re-run `outpost-agent add` with a new
  enroll token (generates a fresh keypair, new machine id). Key-in-place rotation
  for the same machine id can be added later if needed.
- **Lost/forgotten enroll token:** it's only stored hashed and can't be recovered;
  mint a new one. Old ones expire on their own.
- **Audit:** enroll-token creation, every enrollment, and revocation are written
  to `audit_log`.

See [`SECURITY.md`](./SECURITY.md) for the threat model.
