-- Webhook delivery de-duplication. Providers retry deliveries (and a manual
-- "redeliver" reuses the same id), so we record each delivery id and skip any we
-- have already processed — preventing duplicate deploys from the same push.

CREATE TABLE webhook_dedup (
  delivery_id TEXT PRIMARY KEY,      -- GitHub X-GitHub-Delivery / Bitbucket X-Request-UUID
  provider    TEXT NOT NULL,         -- github | bitbucket
  ts          INTEGER NOT NULL       -- unix ms, for retention pruning
);

CREATE INDEX idx_webhook_dedup_ts ON webhook_dedup (ts);
