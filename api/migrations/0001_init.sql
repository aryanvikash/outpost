-- Outpost D1 schema — fleet-wide registry, job history, audit log.
-- Per-machine live queue/state lives in each MachineDO's own SQLite, not here.

-- A machine authenticates with a device-generated Ed25519 keypair: the PRIVATE
-- key never leaves the device; we store only the PUBLIC key here. The agent
-- proves its identity on every connect by signing a short-lived EdDSA JWT that
-- we verify against this public key. A D1 leak therefore exposes no usable
-- credential.
CREATE TABLE machines (
  id           TEXT PRIMARY KEY,            -- e.g. m_<random>
  name         TEXT NOT NULL,
  public_key   TEXT NOT NULL,               -- base64 raw Ed25519 public key (32 bytes)
  status       TEXT NOT NULL DEFAULT 'offline', -- online | offline
  agent_version TEXT,
  created_at   INTEGER NOT NULL,            -- unix ms
  last_seen    INTEGER,                     -- unix ms of last heartbeat/message
  revoked_at   INTEGER                      -- non-null => device revoked
);

CREATE INDEX idx_machines_status ON machines (status);

-- Enrollment tokens authorize the FIRST registration of a device (the only time
-- a secret crosses the wire). They are short-lived; one-time tokens are spent on
-- use, reusable fleet keys decrement remaining_uses.
CREATE TABLE enroll_tokens (
  id             TEXT PRIMARY KEY,          -- e.g. et_<random>
  token_hash     TEXT NOT NULL UNIQUE,      -- SHA-256 hex of the oet_ token
  label          TEXT,
  created_by     TEXT,                      -- admin principal (audit)
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER,                   -- unix ms; null = no expiry
  remaining_uses INTEGER NOT NULL DEFAULT 1,-- one-time token = 1
  used_at        INTEGER,                   -- unix ms of last consumption
  last_machine_id TEXT                      -- last device registered with it
);

CREATE INDEX idx_enroll_token_hash ON enroll_tokens (token_hash);

CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,           -- e.g. j_<random>
  machine_id    TEXT NOT NULL REFERENCES machines(id),
  action        TEXT NOT NULL,
  params_json   TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'queued',
                -- queued | dispatched | running | succeeded | failed
                -- | interrupted | timed_out | canceled
  exit_code     INTEGER,
  error         TEXT,
  timeout_sec   INTEGER NOT NULL,
  idempotent    INTEGER NOT NULL DEFAULT 0, -- 0/1
  created_at    INTEGER NOT NULL,           -- unix ms
  dispatched_at INTEGER,
  finished_at   INTEGER,
  enqueued_by   TEXT                        -- admin principal (audit)
);

CREATE INDEX idx_jobs_machine ON jobs (machine_id, created_at);
CREATE INDEX idx_jobs_status ON jobs (status);

CREATE TABLE job_logs (
  job_id  TEXT NOT NULL REFERENCES jobs(id),
  seq     INTEGER NOT NULL,
  stream  TEXT NOT NULL,                    -- stdout | stderr
  chunk   TEXT NOT NULL,
  ts      INTEGER NOT NULL,                 -- unix ms
  PRIMARY KEY (job_id, stream, seq)
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,              -- unix ms
  actor      TEXT NOT NULL,                 -- admin principal or 'agent:<id>'
  action     TEXT NOT NULL,                 -- enroll | enqueue | revoke | ...
  target     TEXT,                          -- machine id / job id
  detail_json TEXT                          -- arbitrary structured context
);

CREATE INDEX idx_audit_ts ON audit_log (ts);
