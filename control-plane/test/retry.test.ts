import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { adminReq, enrollDevice, signConnectJwt, connectReq } from "./helpers";
import { retryDecision, MAX_JOB_RETRIES } from "../src/machine-do";

describe("retryDecision policy", () => {
  it("always requeues idempotent actions, regardless of attempts", () => {
    expect(retryDecision(true, 0)).toBe("requeue");
    expect(retryDecision(true, 5)).toBe("requeue");
  });

  it("retries a non-idempotent action up to the bound, then interrupts", () => {
    expect(retryDecision(false, 0)).toBe("requeue"); // first interruption → retry
    expect(retryDecision(false, MAX_JOB_RETRIES)).toBe("interrupt");
    expect(retryDecision(false, MAX_JOB_RETRIES + 1)).toBe("interrupt");
  });
});

describe("interrupted deploy is auto-retried on disconnect", () => {
  async function jobStatus(id: string): Promise<string> {
    const res = await SELF.fetch(adminReq(`/api/jobs/${id}`));
    return ((await res.json()) as { status: string }).status;
  }

  // Poll until the job reaches `want` or we give up — handleDisconnect runs
  // asynchronously after the socket closes.
  async function waitForStatus(id: string, want: string): Promise<string> {
    for (let i = 0; i < 40; i++) {
      const s = await jobStatus(id);
      if (s === want) return s;
      await new Promise((r) => setTimeout(r, 25));
    }
    return jobStatus(id);
  }

  it("requeues a dispatched deploy when the agent drops mid-run", async () => {
    const dev = await enrollDevice("retry-agent");
    const jwt = await signConnectJwt(dev);
    const conn = await SELF.fetch(connectReq(jwt, dev.machineId));
    expect(conn.status).toBe(101);
    conn.webSocket!.accept();

    // With the agent connected, a deploy (non-idempotent) is dispatched.
    const enq = await SELF.fetch(
      adminReq(`/api/machines/${dev.machineId}/jobs`, {
        method: "POST",
        body: JSON.stringify({ action: "deploy", params: {} }),
      }),
    );
    const { jobId, status } = (await enq.json()) as {
      jobId: string;
      status: string;
    };
    expect(status).toBe("dispatched");

    // Agent dies mid-run → the job is requeued (retry #1), not interrupted.
    conn.webSocket!.close();
    expect(await waitForStatus(jobId, "queued")).toBe("queued");
  });
});
