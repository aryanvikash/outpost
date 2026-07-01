import { describe, it, expect, vi, afterEach } from "vitest";
import type { Env } from "../src/env";
import { buildAlert, sendAlert, type AlertEvent } from "../src/notify";

const event: AlertEvent = {
  type: "job_failed",
  machineId: "m_1",
  jobId: "j_1",
  action: "deploy",
  status: "failed",
  ts: 1_700_000_000_000,
  detail: "exit 1",
};

afterEach(() => vi.restoreAllMocks());

describe("alert notifier", () => {
  it("shapes the payload with a source tag", () => {
    expect(buildAlert(event)).toEqual({ source: "outpost", ...event });
  });

  it("is a no-op when ALERT_WEBHOOK_URL is unset", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await sendAlert({} as Env, event);
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts JSON to the configured URL", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const url = "https://hooks.example.com/alert";
    await sendAlert({ ALERT_WEBHOOK_URL: url } as Env, event);

    expect(spy).toHaveBeenCalledOnce();
    const [calledUrl, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      source: "outpost",
      type: "job_failed",
      jobId: "j_1",
    });
  });

  it("never throws when the webhook fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(
      sendAlert({ ALERT_WEBHOOK_URL: "https://x.test" } as Env, event),
    ).resolves.toBeUndefined();
  });
});
