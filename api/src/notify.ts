// Operational alerting. Every noteworthy event (a machine going offline, a job
// failing/interrupting) is recorded to D1 for the in-app feed, and — when a
// destination is configured and the event type is enabled — POSTed to an
// outbound webhook (Slack/Discord/custom). Alerting must NEVER affect API
// behavior, so sends are best-effort and swallow their own errors.

export interface AlertEvent {
  /** machine_offline: a machine transitioned online → offline unexpectedly. */
  /** job_failed: a job ended failed / timed_out / interrupted. */
  /** machine_resource: memory or disk crossed RESOURCE_HIGH. */
  type: "machine_offline" | "job_failed" | "machine_resource";
  machineId: string;
  jobId?: string;
  action?: string;
  status?: string;
  ts: number;
  detail?: string;
}

export interface AlertEventToggles {
  machine_offline: boolean;
  job_failed: boolean;
  machine_resource: boolean;
}

/** Shape the payload sent to the alert webhook. Pure, so it's unit-testable. */
export function buildAlert(event: AlertEvent): Record<string, unknown> {
  const what = [event.action, event.status, event.detail].filter(Boolean).join(" · ");
  // `text` makes the same payload a valid Slack incoming-webhook message.
  return { source: "outpost", text: `[outpost] ${event.type} on ${event.machineId}${what ? `: ${what}` : ""}`, ...event };
}

export const RESOURCE_HIGH = 0.9;
export const RESOURCE_OK = 0.85;

/**
 * Resources (memory/disk) over the line. Once flagged, one stays flagged until it
 * drops below RESOURCE_OK, so a box hovering at 90% alerts once, not every beat.
 */
export function resourceBreaches(
  s: { memUsedMb?: number; memTotalMb?: number; diskUsedMb?: number; diskTotalMb?: number } | undefined,
  flagged: string[],
): { flagged: string[]; fresh: string[]; detail: string } {
  const use = {
    memory: s?.memTotalMb ? (s.memUsedMb ?? 0) / s.memTotalMb : 0,
    disk: s?.diskTotalMb ? (s.diskUsedMb ?? 0) / s.diskTotalMb : 0,
  };
  const now = (Object.keys(use) as (keyof typeof use)[]).filter(
    (k) => use[k] >= (flagged.includes(k) ? RESOURCE_OK : RESOURCE_HIGH),
  );
  const fresh = now.filter((k) => !flagged.includes(k));
  return { flagged: now, fresh, detail: fresh.map((k) => `${k} ${Math.round(use[k] * 100)}%`).join(", ") };
}

/** Parse the stored alert_events JSON; both event types default to enabled. */
export function alertEventsFromConfig(json: string | null): AlertEventToggles {
  try {
    const v = json ? (JSON.parse(json) as Record<string, unknown>) : {};
    return {
      machine_offline: v.machine_offline !== false,
      job_failed: v.job_failed !== false,
      machine_resource: v.machine_resource !== false,
    };
  } catch {
    return { machine_offline: true, job_failed: true, machine_resource: true };
  }
}

/**
 * POST an alert to the given URL. Returns true if delivered (2xx). No-op → false
 * when the URL is empty. Never throws — failures are swallowed so alerting can't
 * break job execution.
 */
export async function sendAlert(url: string, event: AlertEvent): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAlert(event)),
    });
    return res.ok;
  } catch {
    return false;
  }
}
