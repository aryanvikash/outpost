import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildAlert,
  sendAlert,
  alertEventsFromConfig,
  type AlertEvent,
} from "../src/notify";

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

  it("is a no-op (returns false) when the URL is empty", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await sendAlert("", event)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts JSON to the configured URL and reports delivery", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const url = "https://hooks.example.com/alert";
    expect(await sendAlert(url, event)).toBe(true);

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

  it("returns false (never throws) when the webhook fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    expect(await sendAlert("https://x.test", event)).toBe(false);
  });

  it("parses event toggles, defaulting to enabled", () => {
    expect(alertEventsFromConfig(null)).toEqual({ machine_offline: true, job_failed: true });
    expect(alertEventsFromConfig('{"job_failed":false}')).toEqual({
      machine_offline: true,
      job_failed: false,
    });
    expect(alertEventsFromConfig("garbage")).toEqual({ machine_offline: true, job_failed: true });
  });
});
