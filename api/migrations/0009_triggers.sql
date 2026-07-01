-- Trigger hooks: secret URLs that fire a bound action on a machine from any
-- external workflow (CI, cron, custom system). Like Vercel/Netlify deploy hooks.
-- Only the SHA-256 hash of the token is stored; the URL is shown once at create.

CREATE TABLE triggers (
  id           TEXT PRIMARY KEY,           -- th_<random>
  token_hash   TEXT NOT NULL UNIQUE,       -- SHA-256 hex of the oth_ token
  label        TEXT,
  machine_id   TEXT NOT NULL REFERENCES machines(id),
  action       TEXT NOT NULL,              -- deploy | restart | run-hook | healthcheck
  params_json  TEXT NOT NULL DEFAULT '{}',
  created_by   TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX idx_triggers_token ON triggers (token_hash);
