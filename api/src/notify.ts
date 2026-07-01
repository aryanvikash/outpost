// Operational alerting. Every noteworthy event (a machine going offline, a job
// failing/interrupting) is recorded to D1 for the in-app feed, and — when a
// destination is configured and the event type is enabled — POSTed to an
// outbound webhook (Slack/Discord/custom). Alerting must NEVER affect API
// behavior, so sends are best-effort and swallow their own errors.

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

export interface AlertEventToggles {
  machine_offline: boolean;
  job_failed: boolean;
}

/** Shape the payload sent to the alert webhook. Pure, so it's unit-testable. */
export function buildAlert(event: AlertEvent): Record<string, unknown> {
  return { source: "outpost", ...event };
}

/** Parse the stored alert_events JSON; both event types default to enabled. */
export function alertEventsFromConfig(json: string | null): AlertEventToggles {
  try {
    const v = json ? (JSON.parse(json) as Record<string, unknown>) : {};
    return {
      machine_offline: v.machine_offline !== false,
      job_failed: v.job_failed !== false,
    };
  } catch {
    return { machine_offline: true, job_failed: true };
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
