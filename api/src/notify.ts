// Operational alerting. Best-effort outgoing webhook fired on noteworthy events
// (a machine going offline, a job failing/interrupting). Posts a compact JSON
// payload to ALERT_WEBHOOK_URL — generic enough for Slack/Discord/custom
// endpoints. Alerting must NEVER affect API behavior, so every send is
// guarded and swallows its own errors.

import type { Env } from "./env";

export interface AlertEvent {
  /** machine_offline: a machine transitioned online → offline unexpectedly. */
  /** job_failed: a job ended failed / timed_out / interrupted. */
  type: "machine_offline" | "job_failed";
  machineId: string;
  jobId?: string;
  action?: string;
  status?: string;
  ts: number;
  detail?: string;
}

/** Shape the payload sent to the alert webhook. Pure, so it's unit-testable. */
export function buildAlert(event: AlertEvent): Record<string, unknown> {
  return { source: "outpost", ...event };
}

/**
 * POST an alert to ALERT_WEBHOOK_URL if configured. No-op when unset. Never
 * throws — failures are swallowed so alerting can't break job execution.
 */
export async function sendAlert(env: Env, event: AlertEvent): Promise<void> {
  const url = env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAlert(event)),
    });
  } catch {
    /* best-effort */
  }
}
