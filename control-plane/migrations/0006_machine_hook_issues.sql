-- Hooks the agent found but could NOT run (with reasons), so the dashboard can
-- surface the problem instead of silently ignoring the file.
ALTER TABLE machines ADD COLUMN hook_issues_json TEXT;
