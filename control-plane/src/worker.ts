// Outpost Worker — the front door.
//
// Responsibilities:
//   1. Terminate the agent's wss upgrade at GET /connect, verify the device's
//      EdDSA-signed JWT against its stored public key, route to the DO.
//   2. Device enrollment at POST /enroll (authorized by a one-time enroll token).
//   3. Serve the admin API (separate auth: ADMIN_TOKEN).
//
// Routing is done with Hono.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import type { Env } from "./env";
import { signAdminJwt, verifyAdminJwt } from "./admin-auth";
import { DB } from "./db/index";
import {
  generateId,
  generateToken,
  sha256Hex,
  timingSafeEqual,
} from "./crypto";
import { isKnownAction } from "./actions";
import { enqueueJob, machineStub } from "./enqueue";
import { webhooks } from "./webhooks";
import {
  jwtMachineId,
  verifyConnectJwt,
  isValidPublicKey,
} from "./device-auth";

export { MachineDO } from "./machine-do";

type AppCtx = { Bindings: Env };

const app = new Hono<AppCtx>();

// Browser access for the admin UI. Auth is via Bearer token (no cookies), so a
// permissive default origin is safe; lock it down with ADMIN_UI_ORIGIN.
// Live job-log tail (browser WebSocket). Registered BEFORE the CORS middleware
// and the admin group: WebSocket handshakes can't carry an Authorization header
// or do CORS preflight, so auth is via a ?token= query param verified here.
app.get("/api/jobs/:id/tail", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.text("expected websocket upgrade", 426);
  }
  const token = c.req.query("token") ?? bearer(c.req.header("Authorization"));
  if (!token || !(await isAdmin(c.env, token))) {
    return c.text("unauthorized", 401);
  }
  const db = new DB(c.env.DB);
  const job = await db.getJob(c.req.param("id"));
  if (!job) return c.text("not found", 404);

  const doReq = new Request(
    `https://machine-do.internal/viewer?jobId=${encodeURIComponent(job.id)}`,
    c.req.raw,
  );
  return machineStub(c.env, job.machine_id).fetch(doReq);
});

app.use("/api/*", (c, next) =>
  cors({
    origin: c.env.ADMIN_UI_ORIGIN || "*",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    maxAge: 86400,
  })(c, next),
);

// ---------------------------------------------------------------------------
// Admin web-UI login: exchange the admin password for a short-lived JWT.
// Registered before the /api admin group so the auth middleware doesn't gate it.
// ---------------------------------------------------------------------------

app.post("/api/admin/login", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  const expected = c.env.ADMIN_PASSWORD || c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: "admin auth not configured" }, 500);
  if (!body.password || !timingSafeEqual(body.password, expected)) {
    return c.json({ error: "invalid password" }, 401);
  }
  const secret = c.env.ADMIN_JWT_SECRET || c.env.ADMIN_TOKEN;
  const { token, expiresAt } = await signAdminJwt(
    secret,
    Math.floor(Date.now() / 1000),
  );
  return c.json({ token, expiresAt });
});

// ---------------------------------------------------------------------------
// Agent connection: wss upgrade → verify device signature → route to MachineDO.
// ---------------------------------------------------------------------------

app.get("/connect", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.text("expected websocket upgrade", 426);
  }

  const jwt = bearer(c.req.header("Authorization"));
  if (!jwt) return c.text("missing device assertion", 401);

  // The kid selects which public key to check against; the signature is what
  // actually authenticates (an attacker can't forge it without the private key).
  const machineId = jwtMachineId(jwt);
  if (!machineId) return c.text("malformed assertion", 401);

  const db = new DB(c.env.DB);
  const machine = await db.getMachine(machineId);
  if (!machine) return c.text("unknown machine", 401);
  if (machine.revoked_at) return c.text("device revoked", 403);

  const nowSec = Math.floor(Date.now() / 1000);
  const v = await verifyConnectJwt(jwt, machine.public_key, machine.id, nowSec);
  if (!v.ok) return c.text(`invalid assertion: ${v.error}`, 401);

  const agentVersion = c.req.header("X-Outpost-Agent-Version") ?? "";

  // Forward the upgrade to the DO with the *verified* machine id.
  const doReq = new Request("https://machine-do.internal/connect", c.req.raw);
  doReq.headers.set("X-Outpost-Machine-Id", machine.id);
  doReq.headers.set("X-Outpost-Agent-Version", agentVersion);

  const stub = machineStub(c.env, machine.id);
  return stub.fetch(doReq);
});

// ---------------------------------------------------------------------------
// Device enrollment. Authorized by an enroll token (NOT the admin token); the
// device registers its own public key here, once.
// ---------------------------------------------------------------------------

app.post("/enroll", async (c) => {
  const enrollToken = bearer(c.req.header("Authorization"));
  if (!enrollToken) return c.json({ error: "missing enroll token" }, 401);

  const body = (await c.req.json().catch(() => ({}))) as {
    publicKey?: string;
    name?: string;
    hostname?: string;
    arch?: string;
    agentVersion?: string;
  };
  const publicKey = (body.publicKey ?? "").trim();
  if (!isValidPublicKey(publicKey)) {
    return c.json({ error: "invalid public key (want base64 raw Ed25519)" }, 400);
  }

  const db = new DB(c.env.DB);
  const tok = await db.findEnrollTokenByHash(await sha256Hex(enrollToken));
  const now = Date.now();
  if (
    !tok ||
    tok.remaining_uses <= 0 ||
    (tok.expires_at !== null && tok.expires_at <= now)
  ) {
    return c.json({ error: "enroll token invalid or expired" }, 401);
  }

  const id = generateId("m");
  const name =
    (body.name ?? "").trim() || body.hostname?.trim() || id;

  await db.insertMachine({
    id,
    name,
    publicKey,
    agentVersion: body.agentVersion,
    createdAt: now,
  });

  // Atomically spend a use; if we lost a race for the last use, roll back.
  const consumed = await db.consumeEnrollToken(tok.id, id, now);
  if (!consumed) {
    await db.revokeMachine(id, now); // mark unusable; never connected
    return c.json({ error: "enroll token already used" }, 409);
  }

  await db.audit({
    ts: now,
    actor: `enroll:${tok.id}`,
    action: "enroll",
    target: id,
    detail: { name, hostname: body.hostname, arch: body.arch },
  });

  return c.json({ machineId: id, name }, 201);
});

// ---------------------------------------------------------------------------
// Admin API. Separate credential (ADMIN_TOKEN).
// ---------------------------------------------------------------------------

const admin = new Hono<AppCtx>();

admin.use("*", async (c: Context<AppCtx>, next: Next) => {
  if (!c.env.ADMIN_TOKEN) return c.json({ error: "admin token not configured" }, 500);
  const token = bearer(c.req.header("Authorization"));
  if (!token || !(await isAdmin(c.env, token))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

/** Create an enrollment token. One-time by default; reusable fleet keys via uses. */
admin.post("/enroll-tokens", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    label?: string;
    uses?: number;
    expiresInMinutes?: number;
  };
  const uses = clampInt(body.uses, 1, 1, 10_000);
  const ttlMin = clampInt(body.expiresInMinutes, 60, 1, 60 * 24 * 30);

  const db = new DB(c.env.DB);
  const id = generateId("et");
  const token = generateToken("oet");
  const now = Date.now();
  const expiresAt = now + ttlMin * 60_000;

  await db.insertEnrollToken({
    id,
    tokenHash: await sha256Hex(token),
    label: (body.label ?? "").trim() || null,
    createdBy: adminActor(c),
    createdAt: now,
    expiresAt,
    remainingUses: uses,
  });
  await db.audit({
    ts: now,
    actor: adminActor(c),
    action: "create-enroll-token",
    target: id,
    detail: { uses, expiresAt },
  });

  // Token returned exactly once; only its hash is stored.
  return c.json({ id, token, uses, expiresAt }, 201);
});

admin.get("/enroll-tokens", async (c) => {
  const db = new DB(c.env.DB);
  const tokens = await db.listEnrollTokens();
  return c.json({
    tokens: tokens.map((t) => ({
      id: t.id,
      label: t.label,
      remainingUses: t.remaining_uses,
      createdAt: t.created_at,
      expiresAt: t.expires_at,
      usedAt: t.used_at,
    })),
  });
});

admin.get("/machines", async (c) => {
  const db = new DB(c.env.DB);
  const machines = await db.listMachines();
  return c.json({
    machines: machines.map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      agentVersion: m.agent_version,
      createdAt: m.created_at,
      lastSeen: m.last_seen,
      revoked: m.revoked_at !== null,
      deploy: m.deploy_json ? JSON.parse(m.deploy_json) : null,
      hooks: m.hooks_json ? JSON.parse(m.hooks_json) : [],
    })),
  });
});

admin.post("/machines/:id/revoke", async (c) => {
  const id = c.req.param("id");
  const db = new DB(c.env.DB);
  const m = await db.getMachine(id);
  if (!m) return c.json({ error: "not found" }, 404);
  const now = Date.now();
  await db.revokeMachine(id, now);
  await db.audit({ ts: now, actor: adminActor(c), action: "revoke", target: id });
  return c.json({ revoked: true });
});

/** Enqueue a job for a machine. */
admin.post("/machines/:id/jobs", async (c) => {
  const machineId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    action?: string;
    params?: Record<string, unknown>;
    timeoutSec?: number;
  };

  const result = await enqueueJob(c.env, {
    machineId,
    action: body.action ?? "",
    params: body.params ?? {},
    timeoutSec: body.timeoutSec,
    actor: adminActor(c),
  });
  if (!result.ok) return c.json({ error: result.error }, result.status as 400);

  return c.json(
    { jobId: result.jobId, status: result.dispatched ? "dispatched" : "queued" },
    202,
  );
});

// --- repo bindings (GitHub triggers) ----------------------------------------

admin.post("/bindings", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    repo?: string;
    branch?: string;
    machineId?: string;
    action?: string;
    params?: Record<string, unknown>;
  };
  const repo = (body.repo ?? "").trim().toLowerCase();
  const branch = (body.branch ?? "").trim();
  const machineId = (body.machineId ?? "").trim();
  const action = body.action ?? "deploy";
  if (!repo.includes("/") || !branch || !machineId) {
    return c.json({ error: "repo (owner/name), branch, machineId required" }, 400);
  }
  if (!isKnownAction(action)) {
    return c.json({ error: `unknown action: ${action}` }, 400);
  }

  const db = new DB(c.env.DB);
  const machine = await db.getMachine(machineId);
  if (!machine) return c.json({ error: "machine not found" }, 404);

  const id = generateId("rb");
  const now = Date.now();
  await db.insertBinding({
    id,
    repoFullName: repo,
    branch,
    machineId,
    action,
    paramsJson: JSON.stringify(body.params ?? {}),
    createdAt: now,
  });
  await db.audit({
    ts: now,
    actor: adminActor(c),
    action: "bind",
    target: id,
    detail: { repo, branch, machineId, action },
  });
  return c.json({ id, repo, branch, machineId, action }, 201);
});

admin.get("/bindings", async (c) => {
  const db = new DB(c.env.DB);
  const bindings = await db.listBindings();
  return c.json({
    bindings: bindings.map((b) => ({
      id: b.id,
      repo: b.repo_full_name,
      branch: b.branch,
      machineId: b.machine_id,
      action: b.action,
      params: JSON.parse(b.params_json),
      createdAt: b.created_at,
    })),
  });
});

admin.get("/webhooks/deliveries", async (c) => {
  const db = new DB(c.env.DB);
  const rows = await db.listDeliveries(50);
  return c.json({
    deliveries: rows.map((d) => ({
      id: d.id,
      ts: d.ts,
      event: d.event,
      repo: d.repo,
      branch: d.branch,
      sha: d.sha,
      matched: d.matched,
      result: d.result,
      jobIds: d.job_ids ? (JSON.parse(d.job_ids) as string[]) : [],
    })),
  });
});

admin.delete("/bindings/:id", async (c) => {
  const db = new DB(c.env.DB);
  await db.deleteBinding(c.req.param("id"));
  await db.audit({
    ts: Date.now(),
    actor: adminActor(c),
    action: "unbind",
    target: c.req.param("id"),
  });
  return c.json({ deleted: true });
});

admin.get("/machines/:id/jobs", async (c) => {
  const db = new DB(c.env.DB);
  const jobs = await db.listJobsForMachine(c.req.param("id"), 50);
  return c.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      machineId: j.machine_id,
      action: j.action,
      status: j.status,
      exitCode: j.exit_code,
      createdAt: j.created_at,
      finishedAt: j.finished_at,
    })),
  });
});

admin.get("/jobs/:id", async (c) => {
  const db = new DB(c.env.DB);
  const job = await db.getJob(c.req.param("id"));
  if (!job) return c.json({ error: "not found" }, 404);
  return c.json({
    id: job.id,
    machineId: job.machine_id,
    action: job.action,
    params: JSON.parse(job.params_json),
    status: job.status,
    exitCode: job.exit_code,
    error: job.error,
    createdAt: job.created_at,
    dispatchedAt: job.dispatched_at,
    finishedAt: job.finished_at,
  });
});

admin.get("/jobs/:id/logs", async (c) => {
  const db = new DB(c.env.DB);
  const job = await db.getJob(c.req.param("id"));
  if (!job) return c.json({ error: "not found" }, 404);
  const logs = await db.getLogs(job.id);
  return c.json({
    jobId: job.id,
    logs: logs.map((l) => ({
      seq: l.seq,
      stream: l.stream,
      chunk: l.chunk,
      ts: l.ts,
    })),
  });
});

admin.post("/jobs/:id/cancel", async (c) => {
  const db = new DB(c.env.DB);
  const job = await db.getJob(c.req.param("id"));
  if (!job) return c.json({ error: "not found" }, 404);
  const stub = machineStub(c.env, job.machine_id);
  await stub.fetch("https://machine-do.internal/cancel", {
    method: "POST",
    body: JSON.stringify({ jobId: job.id }),
  });
  return c.json({ requested: true });
});

app.route("/api", admin);

// GitHub App webhook deliveries (self-authenticating via HMAC signature).
app.route("/webhooks", webhooks);

app.get("/", (c) => c.text("Outpost control plane — see /api (admin) and /connect (agents)\n"));

// ---------------------------------------------------------------------------

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

function adminActor(c: Context<AppCtx>): string {
  return c.req.header("X-Outpost-Admin") ?? "admin";
}

/** True if the token is the static admin token or a valid admin session JWT. */
async function isAdmin(env: Env, token: string): Promise<boolean> {
  const staticToken = env.ADMIN_TOKEN;
  if (!staticToken) return false;
  if (timingSafeEqual(token, staticToken)) return true;
  const secret = env.ADMIN_JWT_SECRET || staticToken;
  return verifyAdminJwt(token, secret, Math.floor(Date.now() / 1000));
}

function clampInt(
  v: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.floor(v), min), max);
}

export default app;
