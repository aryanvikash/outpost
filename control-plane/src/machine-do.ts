// MachineDO — one Durable Object instance per managed machine.
//
// This DO IS the WebSocket server for its agent, using the Hibernation API
// (ctx.acceptWebSocket — NOT ws.accept()), so it can be evicted from memory
// while the socket stays open and only wakes on events. It owns:
//   - the live socket to the agent,
//   - a per-machine job queue + current-job state (its own SQLite storage),
//   - mirroring of state/logs into D1 for fleet-wide history.
//
// Addressed from the Worker via env.MACHINE_DO.getByName(machineId).

import { DurableObject } from "cloudflare:workers";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { Env } from "./env";
import { heartbeatSec, githubAppConfigured, maxQueueAgeSec } from "./env";
import { DB } from "./db/index";
import { queue, type QueueRow } from "./db/queue-schema";
import { setCommitStatus } from "./github-app";
import {
  PROTOCOL_VERSION,
  parseAgentMessage,
  type JobMessage,
  type CancelMessage,
  type WelcomeMessage,
} from "./protocol";

/** Per-socket attachment, used to tell the agent socket from browser viewers. */
type Attachment =
  | { role: "agent"; machineId: string; agentVersion: string }
  | { role: "viewer"; jobId: string };

const TERMINAL = new Set([
  "succeeded",
  "failed",
  "timed_out",
  "canceled",
  "interrupted",
  "superseded",
  "expired",
]);

// Actions where a newer queued job makes an older queued one pointless — a later
// push should deploy the latest commit, not replay every intermediate one.
const COALESCE_ACTIONS = new Set(["deploy"]);

export class MachineDO extends DurableObject<Env> {
  private db: DB;
  /** Drizzle over the DO's own SQLite — the per-machine job queue. */
  private q: DrizzleSqliteDODatabase<{ queue: typeof queue }>;
  private machineIdCache: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new DB(env.DB);
    this.q = drizzle(ctx.storage, { schema: { queue } });
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS queue (
          job_id      TEXT PRIMARY KEY,
          action      TEXT NOT NULL,
          params_json TEXT NOT NULL,
          timeout_sec INTEGER NOT NULL,
          idempotent  INTEGER NOT NULL,
          status      TEXT NOT NULL,
          created_at  INTEGER NOT NULL,
          dispatched_at INTEGER,
          gh_repo     TEXT,
          gh_sha      TEXT,
          gh_installation_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      `);
    });
  }

  // --- Worker → DO entrypoints ----------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/connect") return this.handleConnect(request);
    if (path === "/viewer") return this.handleViewer(request);
    if (path === "/enqueue") return this.handleEnqueue(request);
    if (path === "/cancel") return this.handleCancel(request);
    if (path === "/status") return this.handleStatus();

    return new Response("not found", { status: 404 });
  }

  /** Accept the agent's WebSocket via the Hibernation API. */
  private async handleConnect(request: Request): Promise<Response> {
    const machineId = request.headers.get("X-Outpost-Machine-Id");
    const agentVersion = request.headers.get("X-Outpost-Agent-Version") ?? "";
    if (!machineId) return new Response("missing machine id", { status: 400 });

    await this.setMachineId(machineId);

    // Replace any existing AGENT socket (a machine holds one live agent
    // connection); leave browser viewer sockets alone.
    for (const old of this.ctx.getWebSockets()) {
      if (att(old)?.role !== "agent") continue;
      try {
        old.close(4002, "replaced by newer connection");
      } catch {
        /* ignore */
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernatable accept. After this the DO may be evicted; webSocket*()
    // handlers below are invoked on events.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: "agent", machineId, agentVersion } satisfies Attachment);

    const now = Date.now();
    await this.db.setMachineStatus(machineId, "online", now, agentVersion);
    await this.db.audit({
      ts: now,
      actor: `agent:${machineId}`,
      action: "connect",
      target: machineId,
      detail: { agentVersion },
    });

    // Greet + schedule the liveness alarm.
    const welcome: WelcomeMessage = {
      type: "welcome",
      version: PROTOCOL_VERSION,
      heartbeatSec: heartbeatSec(this.env),
      serverTime: now,
    };
    server.send(JSON.stringify(welcome));
    await this.scheduleLivenessAlarm();

    // Deliver anything that queued while the agent was offline.
    await this.dispatchNext(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Accept a browser viewer WebSocket that live-tails a job. Replays the backlog
   * from D1, then receives fanned-out log chunks until the job ends.
   */
  private async handleViewer(request: Request): Promise<Response> {
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId) return new Response("missing jobId", { status: 400 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: "viewer", jobId } satisfies Attachment);

    // Replay everything so far, then tell the client if it's already finished.
    const logs = await this.db.getLogs(jobId);
    server.send(
      JSON.stringify({
        type: "backlog",
        jobId,
        logs: logs.map((l) => ({ seq: l.seq, stream: l.stream, chunk: l.chunk })),
      }),
    );
    const job = await this.db.getJob(jobId);
    if (job && TERMINAL.has(job.status)) {
      server.send(JSON.stringify({ type: "end", jobId, exitCode: job.exit_code }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Enqueue a job (called by the admin API in the Worker). */
  private async handleEnqueue(request: Request): Promise<Response> {
    const job = (await request.json()) as {
      jobId: string;
      action: string;
      params: Record<string, unknown>;
      timeoutSec: number;
      idempotent: boolean;
      github: { repo: string; sha: string; installationId: number } | null;
    };
    const now = Date.now();

    // Coalesce: a newer deploy supersedes any still-queued deploy of the same
    // repo + branch, so a burst of pushes (or a backlog built up while the agent
    // was offline) collapses to the latest commit instead of replaying each one.
    // A job already dispatched/running is in flight and is left untouched.
    //
    // The repo is required in the key: one machine can have bindings for several
    // repos on the same branch, and superseding across repos would drop a repo's
    // deploy entirely. We only coalesce when the repo is known (gh_repo, set for
    // GitHub pushes); without it we can't prove two same-branch deploys share a
    // target, so we conservatively don't coalesce.
    const repo = job.github?.repo ?? null;
    if (COALESCE_ACTIONS.has(job.action) && repo !== null) {
      const branch = branchOf(job.params);
      const stale = this.q
        .select()
        .from(queue)
        .where(
          and(
            eq(queue.status, "queued"),
            eq(queue.action, job.action),
            eq(queue.gh_repo, repo),
          ),
        )
        .all()
        .filter((r) => branchOf(safeParams(r.params_json)) === branch);
      for (const old of stale) {
        this.q.delete(queue).where(eq(queue.job_id, old.job_id)).run();
        await this.db.setJobStatus(old.job_id, "superseded", { finishedAt: now });
      }
    }

    this.q.insert(queue).values({
      job_id: job.jobId,
      action: job.action,
      params_json: JSON.stringify(job.params ?? {}),
      timeout_sec: job.timeoutSec,
      idempotent: job.idempotent ? 1 : 0,
      status: "queued",
      created_at: now,
      gh_repo: job.github?.repo ?? null,
      gh_sha: job.github?.sha ?? null,
      gh_installation_id: job.github?.installationId ?? null,
    }).run();

    const ws = this.agentSocket();
    const dispatched = ws ? await this.dispatchNext(ws) : false;
    return Response.json({ queued: true, dispatched });
  }

  private async handleCancel(request: Request): Promise<Response> {
    const { jobId } = (await request.json()) as { jobId: string };
    const ws = this.agentSocket();
    if (ws) {
      const msg: CancelMessage = {
        type: "cancel",
        version: PROTOCOL_VERSION,
        jobId,
      };
      ws.send(JSON.stringify(msg));
    }
    return Response.json({ requested: true, delivered: ws !== null });
  }

  private async handleStatus(): Promise<Response> {
    const online = this.agentSocket() !== null;
    const queued = this.q
      .select()
      .from(queue)
      .orderBy(asc(queue.created_at))
      .all();
    return Response.json({ online, queue: queued });
  }

  // --- Hibernation WebSocket handlers ---------------------------------------

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (att(ws)?.role === "viewer") return; // viewers are receive-only
    if (typeof message !== "string") return; // binary frames unused
    const msg = parseAgentMessage(message);
    if (!msg) return;

    const machineId = await this.getMachineId();
    if (!machineId) return;
    const now = Date.now();

    switch (msg.type) {
      case "hello": {
        await this.db.setMachineStatus(
          machineId,
          "online",
          now,
          msg.agentVersion,
        );
        if (msg.deploy) {
          await this.db.setMachineDeploy(machineId, JSON.stringify(msg.deploy));
        }
        // Set hooks + issues on every hello (even when empty) so stale entries
        // clear once the operator fixes or removes a hook.
        await this.db.setMachineHooks(
          machineId,
          JSON.stringify(msg.hooks ?? []),
        );
        await this.db.setMachineHookIssues(
          machineId,
          JSON.stringify(msg.hookIssues ?? []),
        );
        break;
      }
      case "heartbeat": {
        await this.db.touchMachine(machineId, now);
        await this.scheduleLivenessAlarm();
        break;
      }
      case "ack": {
        this.q
          .update(queue)
          .set({ status: "running" })
          .where(eq(queue.job_id, msg.jobId))
          .run();
        await this.db.setJobStatus(msg.jobId, "running");
        break;
      }
      case "log": {
        await this.db.appendLog({
          job_id: msg.jobId,
          seq: msg.seq,
          stream: msg.stream,
          chunk: msg.chunk,
          ts: now,
        });
        // Live-tail: push the chunk to any browser viewers watching this job.
        this.fanOut(msg.jobId, {
          type: "log",
          jobId: msg.jobId,
          seq: msg.seq,
          stream: msg.stream,
          chunk: msg.chunk,
        });
        break;
      }
      case "result": {
        await this.completeJob(ws, msg.jobId, msg.exitCode, msg.error ?? null);
        break;
      }
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // A viewer leaving must not affect machine/job state.
    if (att(ws)?.role === "agent") await this.handleDisconnect();
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    if (att(ws)?.role === "agent") await this.handleDisconnect();
  }

  /** Liveness alarm: if no heartbeat within 2.5× interval, mark offline. */
  override async alarm(): Promise<void> {
    const machineId = await this.getMachineId();
    if (!machineId) return;
    if (this.agentSocket() === null) {
      await this.db.setMachineStatus(machineId, "offline", Date.now());
      return;
    }
    const m = await this.db.getMachine(machineId);
    const threshold = heartbeatSec(this.env) * 2.5 * 1000;
    if (m?.last_seen && Date.now() - m.last_seen > threshold) {
      await this.db.setMachineStatus(machineId, "offline", m.last_seen);
      // Half-open agent socket: drop it so the agent's reconnect loop takes over.
      try {
        this.agentSocket()?.close(1001, "liveness timeout");
      } catch {
        /* ignore */
      }
    } else {
      await this.scheduleLivenessAlarm();
    }
  }

  // --- internals -------------------------------------------------------------

  /** Push the oldest queued job if nothing is currently in flight. */
  private async dispatchNext(ws: WebSocket): Promise<boolean> {
    await this.expireStaleQueued();

    const inFlight = this.q
      .select()
      .from(queue)
      .where(inArray(queue.status, ["dispatched", "running"]))
      .limit(1)
      .all();
    if (inFlight.length > 0) return false;

    const next = this.q
      .select()
      .from(queue)
      .where(eq(queue.status, "queued"))
      .orderBy(asc(queue.created_at))
      .limit(1)
      .all();
    if (next.length === 0) return false;

    const job = next[0];
    const now = Date.now();
    const msg: JobMessage = {
      type: "job",
      version: PROTOCOL_VERSION,
      jobId: job.job_id,
      action: job.action,
      params: JSON.parse(job.params_json) as Record<string, unknown>,
      timeoutSec: job.timeout_sec,
    };
    ws.send(JSON.stringify(msg));

    this.q
      .update(queue)
      .set({ status: "dispatched", dispatched_at: now })
      .where(eq(queue.job_id, job.job_id))
      .run();
    await this.db.setJobStatus(job.job_id, "dispatched", { dispatchedAt: now });
    this.postCommitStatus(job, "pending", `running ${job.action}…`);
    return true;
  }

  /**
   * Expire any job that has sat queued longer than the configured TTL, so a long
   * agent outage doesn't end in a deploy of a stale commit when it reconnects.
   * Only 'queued' jobs are touched; in-flight jobs are never expired here.
   */
  private async expireStaleQueued(): Promise<void> {
    const cutoff = Date.now() - maxQueueAgeSec(this.env) * 1000;
    const stale = this.q
      .select()
      .from(queue)
      .where(and(eq(queue.status, "queued"), lt(queue.created_at, cutoff)))
      .all();
    const now = Date.now();
    for (const job of stale) {
      this.q.delete(queue).where(eq(queue.job_id, job.job_id)).run();
      await this.db.setJobStatus(job.job_id, "expired", {
        finishedAt: now,
        error: "expired before dispatch (queue TTL)",
      });
    }
  }

  private async completeJob(
    ws: WebSocket,
    jobId: string,
    exitCode: number,
    error: string | null,
  ): Promise<void> {
    const now = Date.now();
    let status = exitCode === 0 ? "succeeded" : "failed";
    if (exitCode === 124) status = "timed_out";
    if (exitCode === 130) status = "canceled";

    // Read the row (for GitHub context) before removing it from the queue.
    const rows = this.q
      .select()
      .from(queue)
      .where(eq(queue.job_id, jobId))
      .all();

    this.q.delete(queue).where(eq(queue.job_id, jobId)).run();
    await this.db.setJobStatus(jobId, status, {
      exitCode,
      error,
      finishedAt: now,
    });

    if (rows.length > 0) {
      const ghState = exitCode === 0 ? "success" : "failure";
      this.postCommitStatus(
        rows[0],
        ghState,
        exitCode === 0 ? "deploy succeeded" : `deploy ${status} (exit ${exitCode})`,
      );
    }

    // Tell live-tail viewers the job finished so they can stop the stream.
    this.fanOut(jobId, { type: "end", jobId, exitCode });

    // A finished job frees the slot — dispatch the next queued one.
    await this.dispatchNext(ws);
  }

  /**
   * Post a GitHub commit status for jobs that carry GitHub context, when App
   * credentials are configured. Best-effort and non-blocking: failures are
   * swallowed so deploy feedback never affects job execution.
   */
  private postCommitStatus(
    job: QueueRow,
    state: "pending" | "success" | "failure",
    description: string,
  ): void {
    if (!githubAppConfigured(this.env)) return;
    if (!job.gh_repo || !job.gh_sha || job.gh_installation_id === null) return;

    const creds = {
      appId: this.env.GITHUB_APP_ID!,
      privateKeyPem: this.env.GITHUB_APP_PRIVATE_KEY!,
    };
    const nowSec = Math.floor(Date.now() / 1000);
    this.ctx.waitUntil(
      setCommitStatus(
        creds,
        job.gh_installation_id,
        job.gh_repo,
        job.gh_sha,
        { state, description, context: `outpost/${job.action}` },
        nowSec,
      ).catch(() => {
        /* best-effort feedback */
      }),
    );
  }

  /**
   * Connection lost. Mark offline. Any job that was dispatched/running but never
   * returned a result is INTERRUPTED. Per PROTOCOL.md §6 it is not silently
   * re-run unless its action is idempotent (then it's requeued for next connect).
   */
  private async handleDisconnect(): Promise<void> {
    const machineId = await this.getMachineId();
    if (!machineId) return;

    const inFlight = this.q
      .select()
      .from(queue)
      .where(inArray(queue.status, ["dispatched", "running"]))
      .all();

    const now = Date.now();
    for (const job of inFlight) {
      if (job.idempotent) {
        // Safe to retry: reset to queued, delivered on next connect.
        this.q
          .update(queue)
          .set({ status: "queued", dispatched_at: null })
          .where(eq(queue.job_id, job.job_id))
          .run();
        await this.db.setJobStatus(job.job_id, "queued");
      } else {
        // Non-idempotent: terminate as interrupted, require manual re-enqueue.
        this.q.delete(queue).where(eq(queue.job_id, job.job_id)).run();
        await this.db.setJobStatus(job.job_id, "interrupted", {
          finishedAt: now,
          error: "connection lost before result",
        });
      }
    }

    await this.db.setMachineStatus(machineId, "offline", now);
    await this.db.audit({
      ts: now,
      actor: `agent:${machineId}`,
      action: "disconnect",
      target: machineId,
    });
  }

  /** The agent's socket (there is at most one), ignoring browser viewers. */
  private agentSocket(): WebSocket | null {
    for (const ws of this.ctx.getWebSockets()) {
      if (att(ws)?.role === "agent") return ws;
    }
    return null;
  }

  /** Send a message to every viewer socket tailing the given job. */
  private fanOut(jobId: string, msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const a = att(ws);
      if (a?.role === "viewer" && a.jobId === jobId) {
        try {
          ws.send(data);
        } catch {
          /* viewer gone */
        }
      }
    }
  }

  private async scheduleLivenessAlarm(): Promise<void> {
    const when = Date.now() + heartbeatSec(this.env) * 2.5 * 1000;
    await this.ctx.storage.setAlarm(when);
  }

  private async getMachineId(): Promise<string | null> {
    if (this.machineIdCache) return this.machineIdCache;
    const v = await this.ctx.storage.get<string>("machineId");
    if (v) this.machineIdCache = v;
    // Fall back to the socket attachment after a hibernation wake.
    if (!this.machineIdCache) {
      const ws = this.agentSocket();
      if (ws) {
        const att = ws.deserializeAttachment() as {
          machineId?: string;
        } | null;
        if (att?.machineId) this.machineIdCache = att.machineId;
      }
    }
    return this.machineIdCache;
  }

  private async setMachineId(id: string): Promise<void> {
    this.machineIdCache = id;
    await this.ctx.storage.put("machineId", id);
  }
}

/** Read a socket's attachment (role tag), or null. */
function att(ws: WebSocket): Attachment | null {
  return (ws.deserializeAttachment() as Attachment | null) ?? null;
}

/** The branch a deploy targets, "" if unset — the coalescing key. */
function branchOf(params: Record<string, unknown>): string {
  return typeof params.branch === "string" ? params.branch : "";
}

function safeParams(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
