-- Phase 6: GitHub App triggers.
--
-- repo_bindings maps a (repo, branch) to the job to enqueue on push. A GitHub
-- App install delivers push events natively to /webhooks/github; we look up the
-- binding and enqueue the deploy.

CREATE TABLE repo_bindings (
  id             TEXT PRIMARY KEY,           -- e.g. rb_<random>
  repo_full_name TEXT NOT NULL,              -- owner/repo (lowercased)
  branch         TEXT NOT NULL,              -- branch name (no refs/heads/)
  machine_id     TEXT NOT NULL REFERENCES machines(id),
  action         TEXT NOT NULL DEFAULT 'deploy',
  params_json    TEXT NOT NULL DEFAULT '{}', -- base params; branch is injected
  created_at     INTEGER NOT NULL,
  UNIQUE (repo_full_name, branch, machine_id)
);

CREATE INDEX idx_bindings_lookup ON repo_bindings (repo_full_name, branch);

-- GitHub context carried on a job, so the DO can post commit-status feedback.
ALTER TABLE jobs ADD COLUMN gh_repo TEXT;
ALTER TABLE jobs ADD COLUMN gh_sha TEXT;
ALTER TABLE jobs ADD COLUMN gh_installation_id INTEGER;
