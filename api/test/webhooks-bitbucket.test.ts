import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { adminReq, enrollDevice } from "./helpers";

const WEBHOOK_SECRET = "test-webhook-secret";

async function enroll(name: string): Promise<string> {
  return (await enrollDevice(name)).machineId;
}

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

// A Bitbucket repo:push payload carries push.changes[], not a single ref.
function pushBody(repo: string, branch: string, sha = "abc123def456"): string {
  return JSON.stringify({
    repository: { full_name: repo },
    push: {
      changes: [
        { new: { type: "branch", name: branch, target: { hash: sha } } },
      ],
    },
  });
}

async function deliver(
  event: string,
  body: string,
  sig?: string,
  deliveryId?: string,
): Promise<Response> {
  const headers = new Headers({
    "X-Event-Key": event,
    "Content-Type": "application/json",
  });
  if (sig !== undefined) headers.set("X-Hub-Signature", sig);
  if (deliveryId !== undefined) headers.set("X-Request-UUID", deliveryId);
  return SELF.fetch(
    new Request("https://cp.test/webhooks/bitbucket", { method: "POST", body, headers }),
  );
}

describe("bitbucket webhook signature", () => {
  it("rejects a missing signature", async () => {
    const res = await deliver("repo:push", pushBody("acme/web", "main"));
    expect(res.status).toBe(401);
  });

  it("rejects a wrong signature", async () => {
    const res = await deliver("repo:push", pushBody("acme/web", "main"), "sha256=deadbeef");
    expect(res.status).toBe(401);
  });

  it("accepts diagnostics:ping with a valid signature", async () => {
    const body = JSON.stringify({ test: true });
    const res = await deliver("diagnostics:ping", body, await sign(body));
    expect(res.status).toBe(200);
    expect((await res.json()) as { pong: boolean }).toMatchObject({ pong: true });
  });
});

describe("bitbucket push → deploy binding", () => {
  it("ignores a push with no matching binding", async () => {
    const body = pushBody("nobody/unbound", "main");
    const res = await deliver("repo:push", body, await sign(body));
    expect(res.status).toBe(200);
    expect((await res.json()) as { matched: number }).toMatchObject({ matched: 0 });
  });

  it("enqueues a deploy when a binding matches", async () => {
    const machineId = await enroll("web-bb");

    const bindRes = await SELF.fetch(
      adminReq("/api/bindings", {
        method: "POST",
        body: JSON.stringify({ repo: "Acme/Web", branch: "main", machineId }),
      }),
    );
    expect(bindRes.status).toBe(201);

    // Repo is matched case-insensitively (binding lowercased on write).
    const body = pushBody("acme/web", "main");
    const res = await deliver("repo:push", body, await sign(body));
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      matched: number;
      enqueued: Array<{ jobId: string; machineId: string }>;
    };
    expect(out.matched).toBe(1);
    expect(out.enqueued).toHaveLength(1);
    expect(out.enqueued[0].machineId).toBe(machineId);

    // The enqueued job is a deploy of the pushed branch.
    const jobRes = await SELF.fetch(adminReq(`/api/jobs/${out.enqueued[0].jobId}`));
    const job = (await jobRes.json()) as {
      action: string;
      params: { branch: string };
    };
    expect(job.action).toBe("deploy");
    expect(job.params.branch).toBe("main");
  });

  it("ignores pushes to a non-bound branch", async () => {
    const machineId = await enroll("web-bb2");
    await SELF.fetch(
      adminReq("/api/bindings", {
        method: "POST",
        body: JSON.stringify({ repo: "acme/api", branch: "main", machineId }),
      }),
    );
    const body = pushBody("acme/api", "feature/x");
    const res = await deliver("repo:push", body, await sign(body));
    expect((await res.json()) as { matched: number }).toMatchObject({ matched: 0 });
  });

  it("ignores tag pushes and branch deletions", async () => {
    const tag = JSON.stringify({
      repository: { full_name: "acme/web" },
      push: { changes: [{ new: { type: "tag", name: "v1.0.0" } }] },
    });
    const tagRes = await deliver("repo:push", tag, await sign(tag));
    expect((await tagRes.json()) as { ignored?: string }).toMatchObject({
      ignored: "no branch changes",
    });

    const del = JSON.stringify({
      repository: { full_name: "acme/web" },
      push: { changes: [{ new: null }] },
    });
    const delRes = await deliver("repo:push", del, await sign(del));
    expect((await delRes.json()) as { ignored?: string }).toMatchObject({
      ignored: "no branch changes",
    });
  });

  it("fans out across multiple branch changes in one push", async () => {
    const m1 = await enroll("multi-1");
    const m2 = await enroll("multi-2");
    await SELF.fetch(
      adminReq("/api/bindings", {
        method: "POST",
        body: JSON.stringify({ repo: "acme/multi", branch: "main", machineId: m1 }),
      }),
    );
    await SELF.fetch(
      adminReq("/api/bindings", {
        method: "POST",
        body: JSON.stringify({ repo: "acme/multi", branch: "staging", machineId: m2 }),
      }),
    );

    const body = JSON.stringify({
      repository: { full_name: "acme/multi" },
      push: {
        changes: [
          { new: { type: "branch", name: "main", target: { hash: "aaa" } } },
          { new: { type: "branch", name: "staging", target: { hash: "bbb" } } },
        ],
      },
    });
    const res = await deliver("repo:push", body, await sign(body));
    const out = (await res.json()) as { matched: number; enqueued: unknown[] };
    expect(out.matched).toBe(2);
    expect(out.enqueued).toHaveLength(2);
  });

  it("de-dups a redelivered push (same X-Request-UUID)", async () => {
    const machineId = await enroll("bb-dedup");
    await SELF.fetch(
      adminReq("/api/bindings", {
        method: "POST",
        body: JSON.stringify({ repo: "acme/dedup-bb", branch: "main", machineId }),
      }),
    );
    const body = pushBody("acme/dedup-bb", "main");
    const sig = await sign(body);

    const first = await deliver("repo:push", body, sig, "bb-delivery-1");
    expect((await first.json()) as { matched: number }).toMatchObject({ matched: 1 });

    const second = await deliver("repo:push", body, sig, "bb-delivery-1");
    expect((await second.json()) as { duplicate?: boolean }).toMatchObject({
      duplicate: true,
    });

    const jobsRes = await SELF.fetch(adminReq(`/api/machines/${machineId}/jobs`));
    const { jobs } = (await jobsRes.json()) as { jobs: Array<{ action: string }> };
    expect(jobs.filter((j) => j.action === "deploy")).toHaveLength(1);
  });

  it("logs invalid-signature deliveries", async () => {
    await deliver("repo:push", pushBody("acme/bad-bb", "main"), "sha256=deadbeef");
    const res = await SELF.fetch(adminReq("/api/webhooks/deliveries"));
    const { deliveries } = (await res.json()) as {
      deliveries: Array<{ result: string }>;
    };
    expect(deliveries.some((d) => d.result === "invalid signature")).toBe(true);
  });
});
