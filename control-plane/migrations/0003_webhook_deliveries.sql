-- Recent GitHub webhook deliveries, for observability in the admin UI.

CREATE TABLE webhook_deliveries (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,           -- unix ms
  event    TEXT NOT NULL,              -- push | ping | <other>
  repo     TEXT,                       -- owner/repo (lowercased)
  branch   TEXT,
  sha      TEXT,
  matched  INTEGER NOT NULL DEFAULT 0, -- bindings matched
  result   TEXT,                       -- summary, e.g. "enqueued 1", "no binding"
  job_ids  TEXT                        -- JSON array of enqueued job ids
);

CREATE INDEX idx_webhook_deliveries_ts ON webhook_deliveries (ts);
