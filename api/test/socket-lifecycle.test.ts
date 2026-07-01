import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { adminReq, enrollDevice, signConnectJwt, connectReq } from "./helpers";
import { DB } from "../src/db/index";
import { PROTOCOL_VERSION } from "../src/protocol";

const settle = () => new Promise((r) => setTimeout(r, 150));

describe("late job result after cancellation (revoke race)", () => {
  it("does not overwrite a canceled job with a late success result", async () => {
    const dev = await enrollDevice("late-result");
    const conn = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    expect(conn.status).toBe(101);
    conn.webSocket!.accept();

    // A job already terminalized as canceled (e.g. by revoke), with no DO queue
    // row — exactly the state completeJob must not clobber.
    const db = new DB(env.DB);
    const jobId = "j_late_result";
    await db.insertJob({
      id: jobId,
      machineId: dev.machineId,
      action: "deploy",
      paramsJson: "{}",
      timeoutSec: 60,
      idempotent: false,
      createdAt: 1,
      enqueuedBy: "test",
    });
    await db.setJobStatus(jobId, "canceled", { finishedAt: 2, error: "machine revoked" });

    // The agent sends a late success result for it — must be ignored.
    conn.webSocket!.send(
      JSON.stringify({ type: "result", version: PROTOCOL_VERSION, jobId, exitCode: 0, finishedAt: 3 }),
    );
    await settle();

    const res = await SELF.fetch(adminReq(`/api/jobs/${jobId}`));
    expect(((await res.json()) as { status: string }).status).toBe("canceled");
  });
});

describe("socket replacement does not flap the machine offline", () => {
  it("stays online when a second connection replaces the first", async () => {
    const dev = await enrollDevice("replace");
    const c1 = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    expect(c1.status).toBe(101);
    c1.webSocket!.accept();

    // A new connection replaces the old socket (the DO closes it with 4002).
    const c2 = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    expect(c2.status).toBe(101);
    c2.webSocket!.accept();

    // Let the replaced socket's close event process, then confirm the machine is
    // still online — the 4002 close must not mark it offline.
    await settle();

    const res = await SELF.fetch(adminReq("/api/machines"));
    const { machines } = (await res.json()) as {
      machines: Array<{ id: string; status: string }>;
    };
    expect(machines.find((m) => m.id === dev.machineId)?.status).toBe("online");
  });
});
