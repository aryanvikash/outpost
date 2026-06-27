// Bitbucket webhook receiver.
//
// A Bitbucket repository webhook (configured per-repo with a shared secret)
// delivers events here. We verify the HMAC signature (X-Hub-Signature), and for
// `repo:push` events look up repo+branch bindings and enqueue the configured job
// (default: deploy that branch). Unlike GitHub, a single push can carry several
// branch updates (push.changes[]), so we fan out over them.
//
// Commit build-status feedback: this scaffold enqueues deploys but does not yet
// post terminal SUCCESSFUL/FAILED build statuses back to the commit — that needs
// the job to carry Bitbucket context (workspace/repo + provider) so the Durable
// Object can call setBuildStatus() on completion, the way the GitHub path uses
// gh_installation_id. The poster (./bitbucket.ts setBuildStatus) is ready for
// that follow-up. See control-plane/README.md.

import { Hono } from "hono";
import type { Env } from "./env";
import { DB } from "./db/index";
import {
  verifyBitbucketSignature,
  parseBitbucketPush,
  bitbucketRepoFullName,
} from "./bitbucket";
import { enqueueJob } from "./enqueue";

type AppCtx = { Bindings: Env };

export const webhooksBitbucket = new Hono<AppCtx>();

webhooksBitbucket.post("/bitbucket", async (c) => {
  const db = new DB(c.env.DB);
  const now = Date.now();
  // Bitbucket sends the event type in X-Event-Key, e.g. "repo:push".
  const event = c.req.header("X-Event-Key") ?? "unknown";

  const secret = c.env.BITBUCKET_WEBHOOK_SECRET;
  if (!secret) {
    await db.recordDelivery({ ts: now, event, result: "webhooks not configured" });
    return c.json({ error: "webhooks not configured" }, 503);
  }

  // Raw body is required for signature verification.
  const raw = await c.req.text();
  const ok = await verifyBitbucketSignature(
    secret,
    raw,
    c.req.header("X-Hub-Signature") ?? null,
  );
  if (!ok) {
    await db.recordDelivery({ ts: now, event, result: "invalid signature" });
    return c.json({ error: "invalid signature" }, 401);
  }

  // Bitbucket's "test connection" button sends diagnostics:ping.
  if (event === "diagnostics:ping") {
    await db.recordDelivery({ ts: now, event, result: "ping" });
    return c.json({ ok: true, pong: true });
  }
  if (event !== "repo:push") {
    await db.recordDelivery({ ts: now, event, result: "ignored" });
    return c.json({ ok: true, ignored: event });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "bad payload" }, 400);
  }

  const repo = bitbucketRepoFullName(payload);
  if (!repo) return c.json({ error: "missing repository" }, 400);

  const changes = parseBitbucketPush(payload);
  if (changes.length === 0) {
    await db.recordDelivery({
      ts: now,
      event,
      repo,
      result: "ignored: no branch changes",
    });
    return c.json({ ok: true, ignored: "no branch changes" });
  }

  // A push may touch several branches; enqueue for each matching binding.
  const enqueued: Array<{ jobId: string; machineId: string; dispatched: boolean }> = [];
  let matched = 0;
  let lastBranch = "";
  let lastSha = "";
  for (const change of changes) {
    lastBranch = change.branch;
    lastSha = change.sha;
    const bindings = await db.findBindings(repo, change.branch);
    matched += bindings.length;
    for (const b of bindings) {
      const baseParams = safeParse(b.params_json);
      // For deploy, the pushed branch is authoritative.
      const params =
        b.action === "deploy" ? { ...baseParams, branch: change.branch } : baseParams;

      const result = await enqueueJob(c.env, {
        machineId: b.machine_id,
        action: b.action,
        params,
        actor: `bitbucket:${repo}@${change.branch}`,
      });
      if (result.ok) {
        enqueued.push({
          jobId: result.jobId,
          machineId: b.machine_id,
          dispatched: result.dispatched,
        });
      }
    }
  }

  await db.recordDelivery({
    ts: now,
    event,
    repo,
    branch: lastBranch,
    sha: lastSha,
    matched,
    result: matched === 0 ? "no binding" : `enqueued ${enqueued.length}`,
    jobIds: enqueued.map((e) => e.jobId),
  });

  return c.json({ ok: true, matched, enqueued });
});

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
