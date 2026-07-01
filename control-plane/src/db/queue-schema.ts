// Drizzle schema for the MachineDO's own SQLite queue — a separate storage tier
// from D1 (per-machine operational state, not fleet-wide records). The DDL lives
// in machine-do.ts (CREATE TABLE IF NOT EXISTS, run in the DO constructor); this
// mirrors it so the queue queries are type-checked and read the same way as the
// D1 layer.

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const queue = sqliteTable("queue", {
  job_id: text("job_id").primaryKey(),
  action: text("action").notNull(),
  params_json: text("params_json").notNull(),
  timeout_sec: integer("timeout_sec").notNull(),
  idempotent: integer("idempotent").notNull(),
  status: text("status").notNull(),
  created_at: integer("created_at").notNull(),
  dispatched_at: integer("dispatched_at"),
  retries: integer("retries").notNull().default(0),
  gh_repo: text("gh_repo"),
  gh_sha: text("gh_sha"),
  gh_installation_id: integer("gh_installation_id"),
});

export type QueueRow = typeof queue.$inferSelect;
