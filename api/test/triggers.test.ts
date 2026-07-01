import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { adminReq, enrollDevice } from "./helpers";

async function createTrigger(
  targets: Array<{ machineId: string; action: string; params?: Record<string, unknown> }>,
  label?: string,
) {
  return SELF.fetch(
    adminReq("/api/triggers", { method: "POST", body: JSON.stringify({ targets, label }) }),
  );
}

describe("trigger hooks", () => {
  it("fans out to every target when the secret URL is hit", async () => {
    const a = await enrollDevice("trig-a");
    const b = await enrollDevice("trig-b");
    const res = await createTrigger(
      [
        { machineId: a.machineId, action: "deploy", params: { branch: "main" } },
        { machineId: b.machineId, action: "restart" },
      ],
      "ship-it",
    );
    expect(res.status).toBe(201);
    const { token, url, id } = (await res.json()) as { token: string; url: string; id: string };
    expect(token).toMatch(/^oth_/);
    expect(url).toContain(`/hooks/${token}`);

    // Public call — no admin auth, the token in the path is the grant.
    const fire = await SELF.fetch(new Request(`https://cp.test/hooks/${token}`, { method: "POST" }));
    expect(fire.status).toBe(200);
    const { enqueued, jobIds } = (await fire.json()) as { enqueued: number; jobIds: string[] };
    expect(enqueued).toBe(2);
    expect(jobIds).toHaveLength(2);

    // Each target produced its bound job.
    const actions = await Promise.all(
      jobIds.map(async (jid) => {
        const j = (await (await SELF.fetch(adminReq(`/api/jobs/${jid}`))).json()) as { action: string };
        return j.action;
      }),
    );
    expect(actions.sort()).toEqual(["deploy", "restart"]);

    // The trigger records its targets + last-used.
    const list = await SELF.fetch(adminReq("/api/triggers"));
    const { triggers } = (await list.json()) as {
      triggers: Array<{ id: string; label: string; lastUsedAt: number | null; targets: unknown[] }>;
    };
    const t = triggers.find((x) => x.id === id);
    expect(t?.label).toBe("ship-it");
    expect(t?.targets).toHaveLength(2);
    expect(t?.lastUsedAt).toBeTruthy();
  });

  it("rejects an unknown token", async () => {
    const res = await SELF.fetch(new Request("https://cp.test/hooks/oth_nope", { method: "POST" }));
    expect(res.status).toBe(404);
  });

  it("rejects a trigger with no targets", async () => {
    const res = await createTrigger([]);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown action in a target", async () => {
    const { machineId } = await enrollDevice("trig-bad");
    const res = await createTrigger([{ machineId, action: "rm-rf" }]);
    expect(res.status).toBe(400);
  });

  it("stops firing after the trigger is deleted", async () => {
    const { machineId } = await enrollDevice("trig-del");
    const created = await createTrigger([{ machineId, action: "healthcheck" }]);
    const { token, id } = (await created.json()) as { token: string; id: string };

    const del = await SELF.fetch(adminReq(`/api/triggers/${id}`, { method: "DELETE" }));
    expect(del.status).toBe(200);

    const fire = await SELF.fetch(new Request(`https://cp.test/hooks/${token}`, { method: "POST" }));
    expect(fire.status).toBe(404);
  });
});
