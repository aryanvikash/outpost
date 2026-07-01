import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { DB } from "../src/db/index";
import { enrollDevice } from "./helpers";

const DAY = 86_400_000;

describe("retention pruning", () => {
  it("deletes history older than the cutoff, keeps recent rows", async () => {
    const db = new DB(env.DB);
    const dev = await enrollDevice("retention"); // creates the machine (FK parent)
    const now = Date.now();
    const old = now - 40 * DAY;
    const recent = now - 1 * DAY;

    // A finished OLD job with a log, plus a finished RECENT job with a log.
    const mkJob = async (id: string, finishedAt: number) => {
      await db.insertJob({
        id,
        machineId: dev.machineId,
        action: "healthcheck",
        paramsJson: "{}",
        timeoutSec: 60,
        idempotent: true,
        createdAt: finishedAt,
        enqueuedBy: "test",
      });
      await db.setJobStatus(id, "succeeded", { exitCode: 0, finishedAt });
      await db.appendLog({ job_id: id, seq: 0, stream: "stdout", chunk: "hi", ts: finishedAt });
    };
    await mkJob("j_old", old);
    await mkJob("j_recent", recent);

    await db.audit({ ts: old, actor: "test", action: "old-event" });
    await db.audit({ ts: recent, actor: "test", action: "recent-event" });
    await db.recordDelivery({ ts: old, event: "push", repo: "a/old" });
    await db.recordDelivery({ ts: recent, event: "push", repo: "a/recent" });
    await db.markDeliverySeen("d_old", "github", old);
    await db.markDeliverySeen("d_recent", "github", recent);

    const removed = await db.pruneOlderThan(now - 30 * DAY, now - 7 * DAY);

    // Old rows are gone.
    expect(await db.getJob("j_old")).toBeNull();
    expect(await db.getLogs("j_old")).toHaveLength(0);
    // A pruned dedup id is insertable again (true = newly seen).
    expect(await db.markDeliverySeen("d_old", "github", now)).toBe(true);

    // Recent rows survive.
    expect(await db.getJob("j_recent")).not.toBeNull();
    expect(await db.getLogs("j_recent")).toHaveLength(1);
    expect(await db.markDeliverySeen("d_recent", "github", now)).toBe(false);

    const deliveries = await db.listDeliveries(50);
    expect(deliveries.some((d) => d.repo === "a/recent")).toBe(true);
    expect(deliveries.some((d) => d.repo === "a/old")).toBe(false);

    // Reported counts reflect exactly the old rows removed.
    expect(removed.jobs).toBe(1);
    expect(removed.jobLogs).toBe(1);
    expect(removed.auditLog).toBe(1);
    expect(removed.webhookDeliveries).toBe(1);
    expect(removed.webhookDedup).toBe(1);
  });

  it("never prunes an unfinished job", async () => {
    const db = new DB(env.DB);
    const dev = await enrollDevice("retention-unfinished");
    const old = Date.now() - 90 * DAY;
    await db.insertJob({
      id: "j_running",
      machineId: dev.machineId,
      action: "deploy",
      paramsJson: "{}",
      timeoutSec: 60,
      idempotent: false,
      createdAt: old, // created long ago, but never finished
      enqueuedBy: "test",
    });

    const removed = await db.pruneOlderThan(Date.now() - 30 * DAY, Date.now() - 7 * DAY);
    expect(removed.jobs).toBe(0);
    expect(await db.getJob("j_running")).not.toBeNull();
  });
});
