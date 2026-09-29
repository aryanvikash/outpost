# Outpost Roadmap — Improvements & Features

Generated from UI/API/Agent review. `[x]` = done, `[ ]` = todo.

## P0 — Fix before scaling

- [x] **Logs will blow D1** — per-job 2 MB cap done (`machine-do.ts` MAX_LOG_BYTES); pagination still todo (`api/src/db/index.ts:291`, `worker.ts:469`, `machine-do.ts:181`)
  - Add per-job cap (e.g. 2MB truncate + `truncated:true`), `?limit/cursor` pagination, virtualized viewer.
- [ ] **Queue is lossy** (`api/src/enqueue.ts:54`, `machine-do.ts:445`)
  - D1-then-DO write has no rollback → orphan jobs; `dispatchNext` serial per-machine; coalesce only `deploy+github`.
  - Add manual retry endpoint, `failed/timed_out` retry, DO queue `LIMIT`, pause/drain.
- [ ] **Auth rough** (`worker.ts:628`, `worker.ts:46`)
  - Single `ADMIN_TOKEN`, spoofable `X-Outpost-Admin`, `?token=` in tail URL leaks, `ADMIN_PASSWORD` falls back to `ADMIN_TOKEN`.
  - Need per-user tokens/scopes + header auth for tail + audit failed logins/cancels/trigger fires.
- [ ] **Agent install insecure** (`install.sh:111`, `update.go:126`, `hooks.go:91`)
  - Only SHA-check (no cosign despite `SECURITY.md:8`), unverified systemd fetch, `--token` in `ps`/history, `022`-only hook check, token-embedded `RepoURL` in hello.
  - Add sig verify, `--token-file`, `lstat` check, redact URL.

## P1 — Daily-use UX

- [x] **Log viewer** (`web/src/routes/job.tsx`)
  - [x] Search with highlight
  - [x] stdout/stderr toggle
  - [x] Timestamps (from API `ts`)
  - [x] Follow/pause + auto-scroll to bottom
  - [x] Copy/download
- [ ] **Jobs** (global page + history)
  - [x] Filter by status (+ search id/action/status, per-machine) — `machine.tsx`
  - [x] Show duration + exit code — `util.ts:formatDuration`, `machine.tsx:JobRow`, `job.tsx`
  - [x] Cancel + Re-run buttons — `api.ts:cancelJob/retryJob`, `machine.tsx`, `job.tsx`
  - [ ] Global jobs page (today per-machine only)
  - [ ] Cursor pagination (today hard 50)
- [ ] **Dashboard** (`web/src/routes/dashboard.tsx`)
  - [x] Search + online/offline filter
  - [ ] Bulk deploy/restart/healthcheck multi-select
  - [x] Fix dead `?machine=` back-link (job page now links to machine)
  - [x] Confirm on delete binding/trigger (`webhooks.tsx`, `triggers.tsx`)
  - [x] Manual Refresh + consistent polling (machines/jobs/deliveries/alerts/triggers/bindings)
  - [x] Revoked show/hide + enroll uses/expiry options + error Retry states
- [x] **Deploy trace**
  - [x] Link all jobs (was `jobIds[0]` only) — `webhooks.tsx:DeliveriesCard`
  - [x] Branch/app validation instead of free text — `machine.tsx`
- [ ] **Agent DX**
  - [ ] `hook test/run/doctor` local dry-run
  - [ ] Fix `OUTPOST_APP_DIR` not reaching hooks (docs lie)
  - [ ] Allow `restart` via hook for non-Node
  - [ ] `pnpm/yarn/bun` + build step
  - [x] Real load1/mem/disk/uptime in `stats.go`, shown on the machine page + `machine_resource` alert

## P2 — New features users will ask for

- [ ] **Real app logs**: opt-in `logs` hook (`pm2 logs --lines 100 --nostream`) as separate tab.
- [ ] **Fleet deploys**: `repo+branch → N machines` with rolling/canary + aggregate status.
- [ ] **Health/metrics**: richer `healthcheck` (disk/git/hook/pm2 status), offline/queue-depth/`interrupted`-storm + D1-size alerts.
- [ ] **Webhooks**: tag/PR support (GitHub drops non-push), Bitbucket build-status feedback, DLQ for failed enqueues.
- [ ] **RBAC/audit UI**: roles, token rotation, queryable audit log.

## Also done (not in original list, same PRs)

- [x] Offline banner + 404 page (`router.tsx`)
- [x] Webhook deliveries search/provider filter + Refresh/Retry (`webhooks.tsx`)
- [x] Triggers/alerts Refresh + loading/error/Retry states
- [x] Mobile `flex-wrap`/truncate fixes, tighter mobile padding
