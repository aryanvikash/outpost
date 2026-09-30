import { SELF, env, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
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

describe("heartbeat stats + resource alert", () => {
  it("stores the latest stats and alerts once when memory crosses 90%", async () => {
    const dev = await enrollDevice("stats");
    const conn = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    conn.webSocket!.accept();
    const beat = (memUsedMb: number) =>
      conn.webSocket!.send(JSON.stringify({
        type: "heartbeat", version: PROTOCOL_VERSION, ts: Date.now(),
        stats: { memUsedMb, memTotalMb: 1000, diskUsedMb: 1, diskTotalMb: 10 },
      }));
    beat(950); await settle();
    beat(960); await settle();

    const { machines } = (await (await SELF.fetch(adminReq("/api/machines"))).json()) as {
      machines: Array<{ id: string; stats: { memUsedMb: number } | null }>;
    };
    expect(machines.find((m) => m.id === dev.machineId)?.stats?.memUsedMb).toBe(960);
    const alerts = await env.DB.prepare("select detail from alerts where machine_id = ? and type = 'machine_resource'")
      .bind(dev.machineId).all();
    expect(alerts.results).toEqual([{ detail: "memory 95%" }]);
  });
});

describe("per-job log cap", () => {
  it("stores up to ~2 MB, marks the cut, drops the rest", async () => {
    const dev = await enrollDevice("logcap");
    const conn = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    conn.webSocket!.accept();
    const jobId = "j_logcap";
    const db = new DB(env.DB);
    await db.insertJob({ id: jobId, machineId: dev.machineId, action: "deploy", paramsJson: "{}", timeoutSec: 60, idempotent: false, createdAt: 1, enqueuedBy: "test" });
    const chunk = "x".repeat(900 * 1024);
    for (let seq = 0; seq < 4; seq++) {
      conn.webSocket!.send(JSON.stringify({ type: "log", version: PROTOCOL_VERSION, jobId, stream: "stdout", seq, chunk }));
      await settle();
    }
    const logs = await db.getLogs(jobId);
    expect(logs.map((l) => l.seq)).toEqual([0, 1, 2]);
    expect(logs[2].chunk).toContain("log truncated at 2 MB");
  });
});

describe("a heartbeat heals a stale offline status", () => {
  it("marks the machine online again", async () => {
    const dev = await enrollDevice("heal");
    const conn = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    conn.webSocket!.accept();
    await settle();
    await new DB(env.DB).setMachineStatus(dev.machineId, "offline", Date.now());
    conn.webSocket!.send(JSON.stringify({ type: "heartbeat", version: PROTOCOL_VERSION, ts: Date.now() }));
    await settle();
    const { machines } = (await (await SELF.fetch(adminReq("/api/machines"))).json()) as {
      machines: Array<{ id: string; status: string }>;
    };
    expect(machines.find((m) => m.id === dev.machineId)?.status).toBe("online");
  });
});

describe("the old socket closing late after a reconnect", () => {
  it("does not mark the machine offline", async () => {
    const dev = await enrollDevice("late-close");
    const c1 = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    c1.webSocket!.accept();
    const c2 = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    c2.webSocket!.accept();
    // The dead process's socket closes with its own code, not the DO's 4002.
    try { c1.webSocket!.close(1001, "going away"); } catch { /* already closed */ }
    await settle();
    const { machines } = (await (await SELF.fetch(adminReq("/api/machines"))).json()) as {
      machines: Array<{ id: string; status: string }>;
    };
    expect(machines.find((m) => m.id === dev.machineId)?.status).toBe("online");
  });
});

describe("offline alert grace period", () => {
  const offlineAlerts = async (id: string) =>
    (await env.DB.prepare("select id from alerts where machine_id = ? and type = 'machine_offline'").bind(id).all()).results.length;
  const age = (id: string) =>
    runInDurableObject(env.MACHINE_DO.get(env.MACHINE_DO.idFromName(id)), async (_i, state) => {
      const p = await state.storage.get<{ ts: number; reason: string }>("pendingOffline");
      if (p) await state.storage.put("pendingOffline", { ...p, ts: p.ts - 200_000 });
    });

  it("holds the alert, then fires it when the agent stays away", async () => {
    const dev = await enrollDevice("grace-away");
    const c = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    c.webSocket!.accept();
    await settle();
    c.webSocket!.close(1001, "going away");
    await settle();
    expect(await offlineAlerts(dev.machineId)).toBe(0);
    await age(dev.machineId);
    await runDurableObjectAlarm(env.MACHINE_DO.get(env.MACHINE_DO.idFromName(dev.machineId)));
    await settle();
    expect(await offlineAlerts(dev.machineId)).toBe(1);
  });

  it("drops the alert when the agent reconnects in time", async () => {
    const dev = await enrollDevice("grace-back");
    const c1 = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    c1.webSocket!.accept();
    await settle();
    c1.webSocket!.close(1001, "restart");
    await settle();
    const c2 = await SELF.fetch(connectReq(await signConnectJwt(dev), dev.machineId));
    c2.webSocket!.accept();
    await settle();
    await age(dev.machineId);
    await runDurableObjectAlarm(env.MACHINE_DO.get(env.MACHINE_DO.idFromName(dev.machineId)));
    await settle();
    expect(await offlineAlerts(dev.machineId)).toBe(0);
  });
});
