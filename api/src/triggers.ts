// Trigger hooks — public secret-URL endpoint. An external workflow (CI, cron, a
// custom system) POSTs to /hooks/:token to fire the action the trigger is bound
// to. The token authenticates by itself (SHA-256 hashed at rest, like enroll
// tokens); no admin credential and no signature needed — knowing the URL is the
// grant. The blast radius is limited: a trigger only fires its one bound action
// on its one bound machine, never an arbitrary command.

import { Hono } from "hono";
import type { Env } from "./env";
import { DB } from "./db/index";
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

  const params = safeParse(trigger.params_json);
  const result = await enqueueJob(c.env, {
    machineId: trigger.machine_id,
    action: trigger.action,
    params,
    actor: `trigger:${trigger.label ?? trigger.id}`,
  });

  await db.touchTrigger(trigger.id, now);
  await db.recordDelivery({
    ts: now,
    provider: "custom",
    event: "trigger",
    repo: trigger.label ?? trigger.id,
    matched: result.ok ? 1 : 0,
    result: result.ok ? "enqueued 1" : result.error,
    jobIds: result.ok ? [result.jobId] : [],
  });

  if (!result.ok) return c.json({ error: result.error }, result.status as 400);
  return c.json({ ok: true, jobId: result.jobId, dispatched: result.dispatched });
});

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
