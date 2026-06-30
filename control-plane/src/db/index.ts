// D1 query layer. All fleet-wide reads/writes go through here so the data access
// is in one auditable place. Backed by Drizzle ORM over the schema in ./schema,
// which is type-checked against the real columns; the hand-written SQL in
// ./migrations remains the source of truth for the DDL.

import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

// Row types are inferred from the schema, so a renamed/removed column is a
// compile error at every call site instead of a silent runtime mismatch.
export type MachineRow = typeof schema.machines.$inferSelect;
export type EnrollTokenRow = typeof schema.enrollTokens.$inferSelect;
export type JobRow = typeof schema.jobs.$inferSelect;
export type RepoBindingRow = typeof schema.repoBindings.$inferSelect;
export type WebhookDeliveryRow = typeof schema.webhookDeliveries.$inferSelect;
export type JobLogRow = typeof schema.jobLogs.$inferSelect;

/** Optional GitHub context attached to a job for commit-status feedback. */
export interface GithubContext {
  repo: string;
  sha: string;
  installationId: number;
}

const {
  machines,
  enrollTokens,
  jobs,
  jobLogs,
  repoBindings,
  webhookDeliveries,
  webhookDedup,
  auditLog,
} = schema;

export class DB {
  private readonly db: DrizzleD1Database<typeof schema>;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  // --- machines --------------------------------------------------------------

  async insertMachine(m: {
    id: string;
    name: string;
    publicKey: string;
    agentVersion?: string;
    createdAt: number;
  }): Promise<void> {
    await this.db.insert(machines).values({
      id: m.id,
      name: m.name,
      public_key: m.publicKey,
      status: "offline",
      agent_version: m.agentVersion ?? null,
      created_at: m.createdAt,
    });
  }

  async getMachine(id: string): Promise<MachineRow | null> {
    const row = await this.db
      .select()
      .from(machines)
      .where(eq(machines.id, id))
      .get();
    return row ?? null;
  }

  async listMachines(): Promise<MachineRow[]> {
    return await this.db
      .select()
      .from(machines)
      .orderBy(desc(machines.created_at))
      .all();
  }

  async setMachineStatus(
    id: string,
    status: "online" | "offline",
    lastSeen: number,
    agentVersion?: string,
  ): Promise<void> {
    // agentVersion is only updated when provided (COALESCE semantics).
    await this.db
      .update(machines)
      .set({
        status,
        last_seen: lastSeen,
        ...(agentVersion != null ? { agent_version: agentVersion } : {}),
      })
      .where(eq(machines.id, id));
  }

  async setMachineDeploy(id: string, deployJson: string): Promise<void> {
    await this.db
      .update(machines)
      .set({ deploy_json: deployJson })
      .where(eq(machines.id, id));
  }

  async setMachineHooks(id: string, hooksJson: string): Promise<void> {
    await this.db
      .update(machines)
      .set({ hooks_json: hooksJson })
      .where(eq(machines.id, id));
  }

  async setMachineHookIssues(id: string, hookIssuesJson: string): Promise<void> {
    await this.db
      .update(machines)
      .set({ hook_issues_json: hookIssuesJson })
      .where(eq(machines.id, id));
  }

  async touchMachine(id: string, lastSeen: number): Promise<void> {
    await this.db
      .update(machines)
      .set({ last_seen: lastSeen })
      .where(eq(machines.id, id));
  }

  async renameMachine(id: string, name: string): Promise<void> {
    await this.db.update(machines).set({ name }).where(eq(machines.id, id));
  }

  async revokeMachine(id: string, ts: number): Promise<void> {
    await this.db
      .update(machines)
      .set({ revoked_at: ts })
      .where(eq(machines.id, id));
  }

  // --- enroll tokens ---------------------------------------------------------

  async insertEnrollToken(t: {
    id: string;
    tokenHash: string;
    label: string | null;
    createdBy: string;
    createdAt: number;
    expiresAt: number | null;
    remainingUses: number;
  }): Promise<void> {
    await this.db.insert(enrollTokens).values({
      id: t.id,
      token_hash: t.tokenHash,
      label: t.label,
      created_by: t.createdBy,
      created_at: t.createdAt,
      expires_at: t.expiresAt,
      remaining_uses: t.remainingUses,
    });
  }

  async findEnrollTokenByHash(hash: string): Promise<EnrollTokenRow | null> {
    const row = await this.db
      .select()
      .from(enrollTokens)
      .where(eq(enrollTokens.token_hash, hash))
      .get();
    return row ?? null;
  }

  async listEnrollTokens(): Promise<EnrollTokenRow[]> {
    return await this.db
      .select()
      .from(enrollTokens)
      .orderBy(desc(enrollTokens.created_at))
      .all();
  }

  /**
   * Atomically consume one use of an enroll token. Returns true if a use was
   * available (and was decremented), false otherwise. The WHERE guard makes
   * concurrent enrollments race-safe: only one can take the last use.
   */
  async consumeEnrollToken(
    id: string,
    machineId: string,
    now: number,
  ): Promise<boolean> {
    const res = await this.db
      .update(enrollTokens)
      .set({
        remaining_uses: sqlDecrement(),
        used_at: now,
        last_machine_id: machineId,
      })
      .where(
        and(
          eq(enrollTokens.id, id),
          gt(enrollTokens.remaining_uses, 0),
          or(
            isNull(enrollTokens.expires_at),
            gt(enrollTokens.expires_at, now),
          ),
        ),
      );
    return (res.meta.changes ?? 0) > 0;
  }

  // --- jobs ------------------------------------------------------------------

  async insertJob(j: {
    id: string;
    machineId: string;
    action: string;
    paramsJson: string;
    timeoutSec: number;
    idempotent: boolean;
    createdAt: number;
    enqueuedBy: string;
    github?: GithubContext;
  }): Promise<void> {
    await this.db.insert(jobs).values({
      id: j.id,
      machine_id: j.machineId,
      action: j.action,
      params_json: j.paramsJson,
      status: "queued",
      timeout_sec: j.timeoutSec,
      idempotent: j.idempotent ? 1 : 0,
      created_at: j.createdAt,
      enqueued_by: j.enqueuedBy,
      gh_repo: j.github?.repo ?? null,
      gh_sha: j.github?.sha ?? null,
      gh_installation_id: j.github?.installationId ?? null,
    });
  }

  async getJob(id: string): Promise<JobRow | null> {
    const row = await this.db.select().from(jobs).where(eq(jobs.id, id)).get();
    return row ?? null;
  }

  async listJobsForMachine(machineId: string, limit = 100): Promise<JobRow[]> {
    return await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.machine_id, machineId))
      .orderBy(desc(jobs.created_at))
      .limit(limit)
      .all();
  }

  async setJobStatus(
    id: string,
    status: string,
    fields: {
      exitCode?: number | null;
      error?: string | null;
      dispatchedAt?: number;
      finishedAt?: number;
    } = {},
  ): Promise<void> {
    // Only provided fields are written (COALESCE semantics): a null/undefined
    // leaves the existing value untouched.
    await this.db
      .update(jobs)
      .set({
        status,
        ...(fields.exitCode != null ? { exit_code: fields.exitCode } : {}),
        ...(fields.error != null ? { error: fields.error } : {}),
        ...(fields.dispatchedAt != null
          ? { dispatched_at: fields.dispatchedAt }
          : {}),
        ...(fields.finishedAt != null
          ? { finished_at: fields.finishedAt }
          : {}),
      })
      .where(eq(jobs.id, id));
  }

  // --- job logs --------------------------------------------------------------

  async appendLog(log: JobLogRow): Promise<void> {
    await this.db.insert(jobLogs).values(log).onConflictDoNothing();
  }

  async getLogs(jobId: string): Promise<JobLogRow[]> {
    return await this.db
      .select()
      .from(jobLogs)
      .where(eq(jobLogs.job_id, jobId))
      .orderBy(asc(jobLogs.ts), asc(jobLogs.seq))
      .all();
  }

  // --- repo bindings (GitHub triggers) --------------------------------------

  async insertBinding(b: {
    id: string;
    repoFullName: string;
    branch: string;
    machineId: string;
    action: string;
    paramsJson: string;
    createdAt: number;
  }): Promise<void> {
    await this.db.insert(repoBindings).values({
      id: b.id,
      repo_full_name: b.repoFullName,
      branch: b.branch,
      machine_id: b.machineId,
      action: b.action,
      params_json: b.paramsJson,
      created_at: b.createdAt,
    });
  }

  async listBindings(): Promise<RepoBindingRow[]> {
    return await this.db
      .select()
      .from(repoBindings)
      .orderBy(desc(repoBindings.created_at))
      .all();
  }

  async findBindings(
    repoFullName: string,
    branch: string,
  ): Promise<RepoBindingRow[]> {
    return await this.db
      .select()
      .from(repoBindings)
      .where(
        and(
          eq(repoBindings.repo_full_name, repoFullName),
          eq(repoBindings.branch, branch),
        ),
      )
      .all();
  }

  async deleteBinding(id: string): Promise<void> {
    await this.db.delete(repoBindings).where(eq(repoBindings.id, id));
  }

  // --- webhook deliveries ----------------------------------------------------

  async recordDelivery(d: {
    ts: number;
    event: string;
    repo?: string | null;
    branch?: string | null;
    sha?: string | null;
    matched?: number;
    result?: string;
    jobIds?: string[];
  }): Promise<void> {
    await this.db.insert(webhookDeliveries).values({
      ts: d.ts,
      event: d.event,
      repo: d.repo ?? null,
      branch: d.branch ?? null,
      sha: d.sha ?? null,
      matched: d.matched ?? 0,
      result: d.result ?? null,
      job_ids: d.jobIds ? JSON.stringify(d.jobIds) : null,
    });
  }

  /**
   * Record a webhook delivery id for de-duplication. Returns true if the id was
   * newly seen (process it), false if it was already recorded (a retry/redeliver
   * — skip it). The PRIMARY KEY + INSERT OR IGNORE makes this race-safe.
   */
  async markDeliverySeen(
    deliveryId: string,
    provider: "github" | "bitbucket",
    ts: number,
  ): Promise<boolean> {
    const res = await this.db
      .insert(webhookDedup)
      .values({ delivery_id: deliveryId, provider, ts })
      .onConflictDoNothing();
    return (res.meta.changes ?? 0) > 0;
  }

  /**
   * Release a previously-claimed delivery id (see markDeliverySeen) so a retry
   * can reprocess it. Called when processing fails after the id was claimed, so
   * a transient error doesn't permanently dedup the push away.
   */
  async forgetDelivery(deliveryId: string): Promise<void> {
    await this.db
      .delete(webhookDedup)
      .where(eq(webhookDedup.delivery_id, deliveryId));
  }

  async listDeliveries(limit = 50): Promise<WebhookDeliveryRow[]> {
    return await this.db
      .select()
      .from(webhookDeliveries)
      .orderBy(desc(webhookDeliveries.ts))
      .limit(limit)
      .all();
  }

  // --- audit -----------------------------------------------------------------

  async audit(entry: {
    ts: number;
    actor: string;
    action: string;
    target?: string;
    detail?: unknown;
  }): Promise<void> {
    await this.db.insert(auditLog).values({
      ts: entry.ts,
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      detail_json: entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
    });
  }
}

// `remaining_uses = remaining_uses - 1` expressed for Drizzle's typed set().
function sqlDecrement() {
  return sql`${enrollTokens.remaining_uses} - 1`;
}
