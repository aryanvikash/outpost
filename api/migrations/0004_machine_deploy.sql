-- The agent reports its deploy target (app dir, git remote, repo URL, pm2 target)
-- in its hello message, so the UI can show where `deploy` will run.

ALTER TABLE machines ADD COLUMN deploy_json TEXT;
