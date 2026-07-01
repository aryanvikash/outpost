-- Triggers fan out to MANY targets (each a machine + action), so one secret URL
-- can, say, deploy several machines or run different actions across a fleet.
-- Rebuild the table to hold a target list instead of a single machine/action.
-- The feature is new with no production triggers worth keeping.

DROP TABLE IF EXISTS triggers;

CREATE TABLE triggers (
  id           TEXT PRIMARY KEY,           -- th_<random>
  token_hash   TEXT NOT NULL UNIQUE,       -- SHA-256 hex of the oth_ token
  label        TEXT,
  targets_json TEXT NOT NULL DEFAULT '[]', -- [{ machineId, action, params }]
  created_by   TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX idx_triggers_token ON triggers (token_hash);
