// GitHub App webhook receiver.
//
// A GitHub App install delivers events to this single endpoint — no per-repo
// webhook is created. We verify the HMAC signature, look up repo+branch
// bindings, and enqueue the configured job (default: deploy that branch). The
// push payload's installation.id + head sha are carried on the job so the DO can
// post commit-status feedback when it finishes.

import { Hono } from "hono";
import type { Env } from "./env";
import { DB } from "./db/index";
import { verifyWebhookSignature } from "./github-app";
import { enqueueJob } from "./enqueue";

type AppCtx = { Bindings: Env };

interface PushPayload {
  ref?: string;
  deleted?: boolean;
  after?: string;
  repository?: { full_name?: string };
  installation?: { id?: number };
}

export const webhooks = new Hono<AppCtx>();

webhooks.post("/github", async (c) => {
  const db = new DB(c.env.DB);
  const now = Date.now();
  const event = c.req.header("X-GitHub-Event") ?? "unknown";

  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    await db.recordDelivery({ ts: now, event, result: "webhooks not configured" });
    return c.json({ error: "webhooks not configured" }, 503);
  }

  // Raw body is required for signature verification.
  const raw = await c.req.text();
  const ok = await verifyWebhookSignature(
    secret,
    raw,
    c.req.header("X-Hub-Signature-256") ?? null,
  );
  if (!ok) {
    // Log so a misconfigured secret is visible in the deliveries feed. Body is
    // unverified, so we record only the (untrusted) event label, nothing parsed.
    await db.recordDelivery({ ts: now, event, result: "invalid signature" });
    return c.json({ error: "invalid signature" }, 401);
  }

  // De-dup retries/redeliveries: GitHub reuses X-GitHub-Delivery on resend.
  const deliveryId = c.req.header("X-GitHub-Delivery");
  if (deliveryId && !(await db.markDeliverySeen(deliveryId, "github", now))) {
    await db.recordDelivery({ ts: now, event, result: "duplicate" });
    return c.json({ ok: true, duplicate: true });
  }

  if (event === "ping") {
    await db.recordDelivery({ ts: now, event: "ping", result: "ping" });
    return c.json({ ok: true, pong: true });
  }
  if (event !== "push") {
    await db.recordDelivery({ ts: now, event, result: "ignored" });
    return c.json({ ok: true, ignored: event });
  }

  let payload: PushPayload;
  try {
    payload = JSON.parse(raw) as PushPayload;
  } catch {
    return c.json({ error: "bad payload" }, 400);
  }

  const ref = payload.ref ?? "";
  const repo = (payload.repository?.full_name ?? "").toLowerCase();
  const sha = payload.after ?? "";
  const installationId = payload.installation?.id;

  if (!ref.startsWith("refs/heads/")) {
    await db.recordDelivery({ ts: now, event: "push", repo, sha, result: "ignored: non-branch ref" });
    return c.json({ ok: true, ignored: "non-branch ref" });
  }
  const branch = ref.slice("refs/heads/".length);
  if (payload.deleted) {
    await db.recordDelivery({ ts: now, event: "push", repo, branch, sha, result: "ignored: branch deleted" });
    return c.json({ ok: true, ignored: "branch deleted" });
  }
  if (!repo) return c.json({ error: "missing repository" }, 400);

  const bindings = await db.findBindings(repo, branch);
  if (bindings.length === 0) {
    await db.recordDelivery({ ts: now, event: "push", repo, branch, sha, matched: 0, result: "no binding" });
    return c.json({ ok: true, matched: 0, message: "no binding for repo/branch" });
  }

  const enqueued: Array<{ jobId: string; machineId: string; dispatched: boolean }> = [];
  for (const b of bindings) {
    const baseParams = safeParse(b.params_json);
    // For deploy, the pushed branch is authoritative.
    const params =
      b.action === "deploy" ? { ...baseParams, branch } : baseParams;

    const github =
      sha && typeof installationId === "number"
        ? { repo, sha, installationId }
        : undefined;

    const result = await enqueueJob(c.env, {
      machineId: b.machine_id,
      action: b.action,
      params,
      actor: `github:${repo}@${branch}`,
      github,
    });
    if (result.ok) {
      enqueued.push({
        jobId: result.jobId,
        machineId: b.machine_id,
        dispatched: result.dispatched,
      });
    }
  }

  await db.recordDelivery({
    ts: now,
    event: "push",
    repo,
    branch,
    sha,
    matched: bindings.length,
    result: `enqueued ${enqueued.length}`,
    jobIds: enqueued.map((e) => e.jobId),
  });

  return c.json({ ok: true, matched: bindings.length, enqueued });
});

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
