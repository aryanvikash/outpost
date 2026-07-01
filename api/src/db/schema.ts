// Drizzle schema for the D1 database. This mirrors the hand-written SQL
// migrations in ./migrations, which remain the source of truth for the actual
// DDL (they are already applied to the production D1). Keep this file in sync
// with those migrations: it exists so the query layer in ./index.ts is
// type-checked against the real columns instead of hand-maintained interfaces.
//
// Column JS keys are deliberately snake_case to match the DB column names, so
// the inferred row types ($inferSelect) line up with the rest of the codebase.

import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const machines = sqliteTable(
  "machines",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    public_key: text("public_key").notNull(),
    status: text("status").notNull().default("offline"),
    agent_version: text("agent_version"),
    created_at: integer("created_at").notNull(),
    last_seen: integer("last_seen"),
    revoked_at: integer("revoked_at"),
    deploy_json: text("deploy_json"),
    hooks_json: text("hooks_json"),
    hook_issues_json: text("hook_issues_json"),
  },
  (t) => ({
    status: index("idx_machines_status").on(t.status),
  }),
);

export const enrollTokens = sqliteTable(
  "enroll_tokens",
  {
    id: text("id").primaryKey(),
    token_hash: text("token_hash").notNull().unique(),
    label: text("label"),
    created_by: text("created_by"),
    created_at: integer("created_at").notNull(),
    expires_at: integer("expires_at"),
    remaining_uses: integer("remaining_uses").notNull().default(1),
    used_at: integer("used_at"),
    last_machine_id: text("last_machine_id"),
  },
  (t) => ({
    hash: index("idx_enroll_token_hash").on(t.token_hash),
  }),
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    machine_id: text("machine_id")
      .notNull()
      .references(() => machines.id),
    action: text("action").notNull(),
    params_json: text("params_json").notNull().default("{}"),
    status: text("status").notNull().default("queued"),
    exit_code: integer("exit_code"),
    error: text("error"),
    timeout_sec: integer("timeout_sec").notNull(),
    idempotent: integer("idempotent").notNull().default(0),
    created_at: integer("created_at").notNull(),
    dispatched_at: integer("dispatched_at"),
    finished_at: integer("finished_at"),
    enqueued_by: text("enqueued_by"),
    gh_repo: text("gh_repo"),
    gh_sha: text("gh_sha"),
    gh_installation_id: integer("gh_installation_id"),
  },
  (t) => ({
    machine: index("idx_jobs_machine").on(t.machine_id, t.created_at),
    status: index("idx_jobs_status").on(t.status),
  }),
);

export const jobLogs = sqliteTable(
  "job_logs",
  {
    job_id: text("job_id")
      .notNull()
      .references(() => jobs.id),
    seq: integer("seq").notNull(),
    stream: text("stream").notNull(),
    chunk: text("chunk").notNull(),
    ts: integer("ts").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.job_id, t.stream, t.seq] }),
  }),
);

export const repoBindings = sqliteTable(
  "repo_bindings",
  {
    id: text("id").primaryKey(),
    repo_full_name: text("repo_full_name").notNull(),
    branch: text("branch").notNull(),
    machine_id: text("machine_id")
      .notNull()
      .references(() => machines.id),
    action: text("action").notNull().default("deploy"),
    params_json: text("params_json").notNull().default("{}"),
    created_at: integer("created_at").notNull(),
  },
  (t) => ({
    lookup: index("idx_bindings_lookup").on(t.repo_full_name, t.branch),
  }),
);

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull(),
    event: text("event").notNull(),
    repo: text("repo"),
    branch: text("branch"),
    sha: text("sha"),
    matched: integer("matched").notNull().default(0),
    result: text("result"),
    job_ids: text("job_ids"),
    provider: text("provider"),
  },
  (t) => ({
    ts: index("idx_webhook_deliveries_ts").on(t.ts),
  }),
);

export const webhookDedup = sqliteTable(
  "webhook_dedup",
  {
    delivery_id: text("delivery_id").primaryKey(),
    provider: text("provider").notNull(),
    ts: integer("ts").notNull(),
  },
  (t) => ({
    ts: index("idx_webhook_dedup_ts").on(t.ts),
  }),
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    detail_json: text("detail_json"),
  },
  (t) => ({
    ts: index("idx_audit_ts").on(t.ts),
  }),
);

export const triggers = sqliteTable(
  "triggers",
  {
    id: text("id").primaryKey(),
    token_hash: text("token_hash").notNull().unique(),
    label: text("label"),
    machine_id: text("machine_id")
      .notNull()
      .references(() => machines.id),
    action: text("action").notNull(),
    params_json: text("params_json").notNull().default("{}"),
    created_by: text("created_by"),
    created_at: integer("created_at").notNull(),
    last_used_at: integer("last_used_at"),
  },
  (t) => ({
    token: index("idx_triggers_token").on(t.token_hash),
  }),
);

export const appConfig = sqliteTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export const alerts = sqliteTable(
  "alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull(),
    type: text("type").notNull(),
    machine_id: text("machine_id"),
    job_id: text("job_id"),
    status: text("status"),
    detail: text("detail"),
    delivered: integer("delivered").notNull().default(0),
  },
  (t) => ({
    ts: index("idx_alerts_ts").on(t.ts),
  }),
);
