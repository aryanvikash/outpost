import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { adminReq } from "./helpers";

describe("alert config + feed", () => {
  it("round-trips the destination and event toggles", async () => {
    const put = await SELF.fetch(
      adminReq("/api/alerts/config", {
        method: "PUT",
        body: JSON.stringify({
          webhookUrl: "https://hooks.slack.com/services/xxx",
          events: { machine_offline: true, job_failed: false },
        }),
      }),
    );
    expect(put.status).toBe(200);

    const get = await SELF.fetch(adminReq("/api/alerts/config"));
    const cfg = (await get.json()) as {
      webhookUrl: string;
      events: { machine_offline: boolean; job_failed: boolean };
    };
    expect(cfg.webhookUrl).toBe("https://hooks.slack.com/services/xxx");
    expect(cfg.events).toEqual({ machine_offline: true, job_failed: false });
  });

  it("returns an alerts feed array", async () => {
    const res = await SELF.fetch(adminReq("/api/alerts"));
    expect(res.status).toBe(200);
    const { alerts } = (await res.json()) as { alerts: unknown[] };
    expect(Array.isArray(alerts)).toBe(true);
  });
});
