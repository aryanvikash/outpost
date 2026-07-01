-- Tag each webhook delivery with the provider that sent it, so the dashboard's
-- webhook log can badge and filter GitHub vs Bitbucket in one global feed.
-- Existing rows stay NULL (unknown provider).

ALTER TABLE webhook_deliveries ADD COLUMN provider TEXT;
