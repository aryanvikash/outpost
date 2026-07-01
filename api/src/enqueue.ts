// Shared job-enqueue path used by both the admin API and the GitHub webhook,
// so validation, persistence, auditing, and DO dispatch stay identical.

import type { Env } from "./env";
import { defaultJobTimeoutSec } from "./env";
import { DB, type GithubContext } from "./db/index";
import { generateId } from "./crypto";
import { ACTIONS, isKnownAction } from "./actions";

export type EnqueueResult =
  | { ok: true; jobId: string; dispatched: boolean }
  | { ok: false; status: number; error: string };

export interface EnqueueInput {
  machineId: string;
  action: string;
  params: Record<string, unknown>;
  timeoutSec?: number;
  actor: string;
  github?: GithubContext;
}

/** Resolve the DO stub for a machine (getByName where available). */
export function machineStub(env: Env, machineId: string): DurableObjectStub {
  const ns = env.MACHINE_DO;
  const maybe = ns as unknown as {
    getByName?: (name: string) => DurableObjectStub;
  };
  if (typeof maybe.getByName === "function") return maybe.getByName(machineId);
  return ns.get(ns.idFromName(machineId));
}

export async function enqueueJob(
  env: Env,
  input: EnqueueInput,
): Promise<EnqueueResult> {
  if (!isKnownAction(input.action)) {
    return { ok: false, status: 400, error: `unknown action: ${input.action}` };
  }
  const spec = ACTIONS[input.action];
  const params = input.params ?? {};
  const invalid = spec.validate(params);
  if (invalid) return { ok: false, status: 400, error: invalid };

  const db = new DB(env.DB);
  const machine = await db.getMachine(input.machineId);
  if (!machine) return { ok: false, status: 404, error: "machine not found" };
  if (machine.revoked_at) return { ok: false, status: 403, error: "machine revoked" };

  const jobId = generateId("j");
  const timeoutSec = clampTimeout(input.timeoutSec, defaultJobTimeoutSec(env));
  const now = Date.now();

  await db.insertJob({
    id: jobId,
    machineId: input.machineId,
    action: input.action,
    paramsJson: JSON.stringify(params),
    timeoutSec,
    idempotent: spec.idempotent,
    createdAt: now,
    enqueuedBy: input.actor,
    github: input.github,
  });
  await db.audit({
    ts: now,
    actor: input.actor,
    action: "enqueue",
    target: jobId,
    detail: { machineId: input.machineId, action: input.action, params },
  });

  const stub = machineStub(env, input.machineId);
  const res = await stub.fetch("https://machine-do.internal/enqueue", {
    method: "POST",
    body: JSON.stringify({
      jobId,
      action: input.action,
      params,
      timeoutSec,
      idempotent: spec.idempotent,
      github: input.github ?? null,
    }),
  });
  const { dispatched } = (await res.json()) as { dispatched: boolean };

  return { ok: true, jobId, dispatched };
}

export function clampTimeout(v: number | undefined, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(Math.floor(v), 3600);
}
