// D1 query helpers. All fleet-wide reads/writes go through here so the SQL is in
// one auditable place.

export interface MachineRow {
  id: string;
  name: string;
  public_key: string; // base64 raw Ed25519 public key
  status: string;
  agent_version: string | null;
  created_at: number;
  last_seen: number | null;
  revoked_at: number | null;
  deploy_json: string | null;
  hooks_json: string | null;
  hook_issues_json: string | null;
}

export interface EnrollTokenRow {
  id: string;
  token_hash: string;
  label: string | null;
  created_by: string | null;
  created_at: number;
  expires_at: number | null;
  remaining_uses: number;
  used_at: number | null;
  last_machine_id: string | null;
}

export interface JobRow {
  id: string;
  machine_id: string;
  action: string;
  params_json: string;
  status: string;
  exit_code: number | null;
  error: string | null;
  timeout_sec: number;
  idempotent: number;
  created_at: number;
  dispatched_at: number | null;
  finished_at: number | null;
  enqueued_by: string | null;
  gh_repo: string | null;
  gh_sha: string | null;
  gh_installation_id: number | null;
}

export interface RepoBindingRow {
  id: string;
  repo_full_name: string;
  branch: string;
  machine_id: string;
  action: string;
  params_json: string;
  created_at: number;
}

/** Optional GitHub context attached to a job for commit-status feedback. */
export interface GithubContext {
  repo: string;
  sha: string;
  installationId: number;
}

export interface WebhookDeliveryRow {
  id: number;
  ts: number;
  event: string;
  repo: string | null;
  branch: string | null;
  sha: string | null;
  matched: number;
  result: string | null;
  job_ids: string | null;
}

export interface JobLogRow {
  job_id: string;
  seq: number;
  stream: string;
  chunk: string;
  ts: number;
}

export class DB {
  constructor(private readonly d1: D1Database) {}

  // --- machines --------------------------------------------------------------

  async insertMachine(m: {
    id: string;
    name: string;
    publicKey: string;
    agentVersion?: string;
    createdAt: number;
  }): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO machines (id, name, public_key, status, agent_version, created_at)
         VALUES (?, ?, ?, 'offline', ?, ?)`,
      )
      .bind(m.id, m.name, m.publicKey, m.agentVersion ?? null, m.createdAt)
      .run();
  }

  async getMachine(id: string): Promise<MachineRow | null> {
    return await this.d1
      .prepare(`SELECT * FROM machines WHERE id = ?`)
      .bind(id)
      .first<MachineRow>();
  }

  async listMachines(): Promise<MachineRow[]> {
    const res = await this.d1
      .prepare(`SELECT * FROM machines ORDER BY created_at DESC`)
      .all<MachineRow>();
    return res.results ?? [];
  }

  async setMachineStatus(
    id: string,
    status: "online" | "offline",
    lastSeen: number,
    agentVersion?: string,
  ): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE machines
            SET status = ?, last_seen = ?,
                agent_version = COALESCE(?, agent_version)
          WHERE id = ?`,
      )
      .bind(status, lastSeen, agentVersion ?? null, id)
      .run();
  }

  async setMachineDeploy(id: string, deployJson: string): Promise<void> {
    await this.d1
      .prepare(`UPDATE machines SET deploy_json = ? WHERE id = ?`)
      .bind(deployJson, id)
      .run();
  }

  async setMachineHooks(id: string, hooksJson: string): Promise<void> {
    await this.d1
      .prepare(`UPDATE machines SET hooks_json = ? WHERE id = ?`)
      .bind(hooksJson, id)
      .run();
  }

  async setMachineHookIssues(id: string, hookIssuesJson: string): Promise<void> {
    await this.d1
      .prepare(`UPDATE machines SET hook_issues_json = ? WHERE id = ?`)
      .bind(hookIssuesJson, id)
      .run();
  }

  async touchMachine(id: string, lastSeen: number): Promise<void> {
    await this.d1
      .prepare(`UPDATE machines SET last_seen = ? WHERE id = ?`)
      .bind(lastSeen, id)
      .run();
  }

  async renameMachine(id: string, name: string): Promise<void> {
    await this.d1
      .prepare(`UPDATE machines SET name = ? WHERE id = ?`)
      .bind(name, id)
      .run();
  }

  async revokeMachine(id: string, ts: number): Promise<void> {
    await this.d1
      .prepare(`UPDATE machines SET revoked_at = ? WHERE id = ?`)
      .bind(ts, id)
      .run();
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
    await this.d1
      .prepare(
        `INSERT INTO enroll_tokens
           (id, token_hash, label, created_by, created_at, expires_at, remaining_uses)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        t.id,
        t.tokenHash,
        t.label,
        t.createdBy,
        t.createdAt,
        t.expiresAt,
        t.remainingUses,
      )
      .run();
  }

  async findEnrollTokenByHash(hash: string): Promise<EnrollTokenRow | null> {
    return await this.d1
      .prepare(`SELECT * FROM enroll_tokens WHERE token_hash = ?`)
      .bind(hash)
      .first<EnrollTokenRow>();
  }

  async listEnrollTokens(): Promise<EnrollTokenRow[]> {
    const res = await this.d1
      .prepare(`SELECT * FROM enroll_tokens ORDER BY created_at DESC`)
      .all<EnrollTokenRow>();
    return res.results ?? [];
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
    const res = await this.d1
      .prepare(
        `UPDATE enroll_tokens
            SET remaining_uses = remaining_uses - 1,
                used_at = ?,
                last_machine_id = ?
          WHERE id = ? AND remaining_uses > 0
            AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .bind(now, machineId, id, now)
      .run();
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
    await this.d1
      .prepare(
        `INSERT INTO jobs
           (id, machine_id, action, params_json, status, timeout_sec,
            idempotent, created_at, enqueued_by,
            gh_repo, gh_sha, gh_installation_id)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        j.id,
        j.machineId,
        j.action,
        j.paramsJson,
        j.timeoutSec,
        j.idempotent ? 1 : 0,
        j.createdAt,
        j.enqueuedBy,
        j.github?.repo ?? null,
        j.github?.sha ?? null,
        j.github?.installationId ?? null,
      )
      .run();
  }

  async getJob(id: string): Promise<JobRow | null> {
    return await this.d1
      .prepare(`SELECT * FROM jobs WHERE id = ?`)
      .bind(id)
      .first<JobRow>();
  }

  async listJobsForMachine(machineId: string, limit = 100): Promise<JobRow[]> {
    const res = await this.d1
      .prepare(
        `SELECT * FROM jobs WHERE machine_id = ?
          ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(machineId, limit)
      .all<JobRow>();
    return res.results ?? [];
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
    await this.d1
      .prepare(
        `UPDATE jobs
            SET status = ?,
                exit_code = COALESCE(?, exit_code),
                error = COALESCE(?, error),
                dispatched_at = COALESCE(?, dispatched_at),
                finished_at = COALESCE(?, finished_at)
          WHERE id = ?`,
      )
      .bind(
        status,
        fields.exitCode ?? null,
        fields.error ?? null,
        fields.dispatchedAt ?? null,
        fields.finishedAt ?? null,
        id,
      )
      .run();
  }

  // --- job logs --------------------------------------------------------------

  async appendLog(log: JobLogRow): Promise<void> {
    await this.d1
      .prepare(
        `INSERT OR IGNORE INTO job_logs (job_id, seq, stream, chunk, ts)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(log.job_id, log.seq, log.stream, log.chunk, log.ts)
      .run();
  }

  async getLogs(jobId: string): Promise<JobLogRow[]> {
    const res = await this.d1
      .prepare(
        `SELECT * FROM job_logs WHERE job_id = ? ORDER BY ts ASC, seq ASC`,
      )
      .bind(jobId)
      .all<JobLogRow>();
    return res.results ?? [];
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
    await this.d1
      .prepare(
        `INSERT INTO repo_bindings
           (id, repo_full_name, branch, machine_id, action, params_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        b.id,
        b.repoFullName,
        b.branch,
        b.machineId,
        b.action,
        b.paramsJson,
        b.createdAt,
      )
      .run();
  }

  async listBindings(): Promise<RepoBindingRow[]> {
    const res = await this.d1
      .prepare(`SELECT * FROM repo_bindings ORDER BY created_at DESC`)
      .all<RepoBindingRow>();
    return res.results ?? [];
  }

  async findBindings(
    repoFullName: string,
    branch: string,
  ): Promise<RepoBindingRow[]> {
    const res = await this.d1
      .prepare(
        `SELECT * FROM repo_bindings WHERE repo_full_name = ? AND branch = ?`,
      )
      .bind(repoFullName, branch)
      .all<RepoBindingRow>();
    return res.results ?? [];
  }

  async deleteBinding(id: string): Promise<void> {
    await this.d1
      .prepare(`DELETE FROM repo_bindings WHERE id = ?`)
      .bind(id)
      .run();
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
    await this.d1
      .prepare(
        `INSERT INTO webhook_deliveries
           (ts, event, repo, branch, sha, matched, result, job_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        d.ts,
        d.event,
        d.repo ?? null,
        d.branch ?? null,
        d.sha ?? null,
        d.matched ?? 0,
        d.result ?? null,
        d.jobIds ? JSON.stringify(d.jobIds) : null,
      )
      .run();
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
    const res = await this.d1
      .prepare(
        `INSERT OR IGNORE INTO webhook_dedup (delivery_id, provider, ts)
         VALUES (?, ?, ?)`,
      )
      .bind(deliveryId, provider, ts)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async listDeliveries(limit = 50): Promise<WebhookDeliveryRow[]> {
    const res = await this.d1
      .prepare(`SELECT * FROM webhook_deliveries ORDER BY ts DESC LIMIT ?`)
      .bind(limit)
      .all<WebhookDeliveryRow>();
    return res.results ?? [];
  }

  // --- audit -----------------------------------------------------------------

  async audit(entry: {
    ts: number;
    actor: string;
    action: string;
    target?: string;
    detail?: unknown;
  }): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO audit_log (ts, actor, action, target, detail_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.ts,
        entry.actor,
        entry.action,
        entry.target ?? null,
        entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
      )
      .run();
  }
}
