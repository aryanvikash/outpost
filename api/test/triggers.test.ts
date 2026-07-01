import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { adminReq, enrollDevice } from "./helpers";

async function createTrigger(machineId: string, body: Record<string, unknown> = {}) {
  const res = await SELF.fetch(
    adminReq("/api/triggers", {
      method: "POST",
      body: JSON.stringify({ machineId, action: "deploy", params: { branch: "main" }, ...body }),
    }),
  );
  return res;
}

describe("trigger hooks", () => {
  it("fires the bound action when the secret URL is hit", async () => {
    const { machineId } = await enrollDevice("trig");
    const res = await createTrigger(machineId, { label: "ci-deploy" });
    expect(res.status).toBe(201);
    const { token, url, id } = (await res.json()) as { token: string; url: string; id: string };
    expect(token).toMatch(/^oth_/);
    expect(url).toContain(`/hooks/${token}`);

    // Public call — no admin auth, the token in the path is the grant.
    const fire = await SELF.fetch(new Request(`https://cp.test/hooks/${token}`, { method: "POST" }));
    expect(fire.status).toBe(200);
    const { jobId } = (await fire.json()) as { jobId: string };

    const jobRes = await SELF.fetch(adminReq(`/api/jobs/${jobId}`));
    const job = (await jobRes.json()) as { action: string; params: { branch: string } };
    expect(job.action).toBe("deploy");
    expect(job.params.branch).toBe("main");

    // The trigger shows a last-used timestamp after firing.
    const list = await SELF.fetch(adminReq("/api/triggers"));
    const { triggers } = (await list.json()) as {
      triggers: Array<{ id: string; lastUsedAt: number | null; label: string }>;
    };
    const t = triggers.find((x) => x.id === id);
    expect(t?.lastUsedAt).toBeTruthy();
    expect(t?.label).toBe("ci-deploy");
  });

  it("rejects an unknown token", async () => {
    const res = await SELF.fetch(new Request("https://cp.test/hooks/oth_nope", { method: "POST" }));
    expect(res.status).toBe(404);
  });

  it("rejects an unknown action at create time", async () => {
    const { machineId } = await enrollDevice("trig-bad");
    const res = await createTrigger(machineId, { action: "rm-rf" });
    expect(res.status).toBe(400);
  });

  it("stops firing after the trigger is deleted", async () => {
    const { machineId } = await enrollDevice("trig-del");
    const created = await createTrigger(machineId);
    const { token, id } = (await created.json()) as { token: string; id: string };

    const del = await SELF.fetch(adminReq(`/api/triggers/${id}`, { method: "DELETE" }));
    expect(del.status).toBe(200);

    const fire = await SELF.fetch(new Request(`https://cp.test/hooks/${token}`, { method: "POST" }));
    expect(fire.status).toBe(404);
  });
});
