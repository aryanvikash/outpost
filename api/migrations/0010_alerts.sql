-- Alerting: an in-app feed of noteworthy events (machine offline, job failed)
-- plus dashboard-managed configuration for the outbound destination.

-- Simple key/value config, dashboard-managed. Holds alert_webhook_url and
-- alert_events (JSON of enabled event types).
CREATE TABLE app_config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,             -- unix ms
  type       TEXT NOT NULL,                -- machine_offline | job_failed
  machine_id TEXT,
  job_id     TEXT,
  status     TEXT,                         -- failed | timed_out | interrupted (for job_failed)
  detail     TEXT,
  delivered  INTEGER NOT NULL DEFAULT 0    -- 1 if the outbound POST succeeded
);

CREATE INDEX idx_alerts_ts ON alerts (ts);
