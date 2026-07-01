import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { adminReq, enrollDevice, signConnectJwt, connectReq } from "./helpers";

async function enqueue(machineId: string, action: string): Promise<string> {
  const res = await SELF.fetch(
    adminReq(`/api/machines/${machineId}/jobs`, {
      method: "POST",
      body: JSON.stringify({ action, params: {} }),
    }),
  );
  return ((await res.json()) as { jobId: string }).jobId;
}

async function jobStatus(id: string): Promise<string> {
  const res = await SELF.fetch(adminReq(`/api/jobs/${id}`));
  return ((await res.json()) as { status: string }).status;
}

describe("revoke severs the machine", () => {
  it("cancels queued jobs and reports no live socket when offline", async () => {
    const dev = await enrollDevice("revoke-offline");
    const j1 = await enqueue(dev.machineId, "healthcheck");
    const j2 = await enqueue(dev.machineId, "healthcheck");
    expect(await jobStatus(j1)).toBe("queued");

    const res = await SELF.fetch(
      adminReq(`/api/machines/${dev.machineId}/revoke`, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revoked: boolean; disconnected: boolean };
    expect(body.revoked).toBe(true);
    expect(body.disconnected).toBe(false); // agent was not connected

    // The DO purged its queue and cancelled the pending jobs in D1.
    expect(await jobStatus(j1)).toBe("canceled");
    expect(await jobStatus(j2)).toBe("canceled");
  });

  it("closes a live agent socket", async () => {
    const dev = await enrollDevice("revoke-live");
    const jwt = await signConnectJwt(dev);
    const conn = await SELF.fetch(connectReq(jwt, dev.machineId));
    expect(conn.status).toBe(101);

    const res = await SELF.fetch(
      adminReq(`/api/machines/${dev.machineId}/revoke`, { method: "POST" }),
    );
    const body = (await res.json()) as { disconnected: boolean };
    expect(body.disconnected).toBe(true);

    try {
      conn.webSocket?.close();
    } catch {
      /* already closed by the DO */
    }
  });

  it("rejects a revoked device's reconnect", async () => {
    const dev = await enrollDevice("revoke-reconnect");
    await SELF.fetch(
      adminReq(`/api/machines/${dev.machineId}/revoke`, { method: "POST" }),
    );
    const jwt = await signConnectJwt(dev);
    const conn = await SELF.fetch(connectReq(jwt, dev.machineId));
    expect(conn.status).toBe(403);
  });
});
