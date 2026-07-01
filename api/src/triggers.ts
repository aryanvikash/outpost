// Trigger hooks — public secret-URL endpoint. An external workflow (CI, cron, a
// custom system) POSTs to /hooks/:token to fire the action the trigger is bound
// to. The token authenticates by itself (SHA-256 hashed at rest, like enroll
// tokens); no admin credential and no signature needed — knowing the URL is the
// grant. The blast radius is limited: a trigger only fires its one bound action
// on its one bound machine, never an arbitrary command.

import { Hono } from "hono";
import type { Env } from "./env";
import { DB, type TriggerTarget } from "./db/index";
import { sha256Hex } from "./crypto";
import { enqueueJob } from "./enqueue";

type AppCtx = { Bindings: Env };

export const triggerHooks = new Hono<AppCtx>();

triggerHooks.post("/:token", async (c) => {
  const token = c.req.param("token");
  const db = new DB(c.env.DB);
  const now = Date.now();

  const trigger = await db.findTriggerByHash(await sha256Hex(token));
  if (!trigger) return c.json({ error: "unknown trigger" }, 404);

  const targets = safeTargets(trigger.targets_json);
  const label = trigger.label ?? trigger.id;

  // Fan out: fire every target, collecting the jobs we managed to enqueue.
  const jobIds: string[] = [];
  const results: Array<{ machineId: string; action: string; jobId?: string; error?: string }> = [];
  for (const t of targets) {
    const r = await enqueueJob(c.env, {
      machineId: t.machineId,
      action: t.action,
      params: t.params ?? {},
      actor: `trigger:${label}`,
    });
    if (r.ok) {
      jobIds.push(r.jobId);
      results.push({ machineId: t.machineId, action: t.action, jobId: r.jobId });
    } else {
      results.push({ machineId: t.machineId, action: t.action, error: r.error });
    }
  }

  await db.touchTrigger(trigger.id, now);
  await db.recordDelivery({
    ts: now,
    provider: "custom",
    event: "trigger",
    repo: label,
    matched: targets.length,
    result: `enqueued ${jobIds.length}`,
    jobIds,
  });

  return c.json({ ok: true, enqueued: jobIds.length, jobIds, results });
});

function safeTargets(json: string): TriggerTarget[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as TriggerTarget[]) : [];
  } catch {
    return [];
  }
}
