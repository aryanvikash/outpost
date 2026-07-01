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

function pushBody(repo: string, branch: string, sha = "abc123def456"): string {
  return JSON.stringify({
    ref: `refs/heads/${branch}`,
    after: sha,
    repository: { full_name: repo },
    installation: { id: 42 },
  });
}

async function deliver(
  event: string,
  body: string,
  sig?: string,
  deliveryId?: string,
): Promise<Response> {
  const headers = new Headers({
    "X-GitHub-Event": event,
    "Content-Type": "application/json",
  });
  if (sig !== undefined) headers.set("X-Hub-Signature-256", sig);
  if (deliveryId !== undefined) headers.set("X-GitHub-Delivery", deliveryId);
  return SELF.fetch(
    new Request("https://cp.test/webhooks/github", { method: "POST", body, headers }),
  );
}

describe("github webhook signature", () => {
  it("rejects a missing signature", async () => {
    const res = await deliver("push", pushBody("acme/web", "main"));
    expect(res.status).toBe(401);
  });

  it("rejects a wrong signature", async () => {
    const res = await deliver("push", pushBody("acme/web", "main"), "sha256=deadbeef");
    expect(res.status).toBe(401);
  });

  it("accepts ping with a valid signature", async () => {
    const body = JSON.stringify({ zen: "hi" });
    const res = await deliver("ping", body, await sign(body));
    expect(res.status).toBe(200);
    expect((await res.json()) as { pong: boolean }).toMatchObject({ pong: true });
  });
});

describe("github push → deploy binding", () => {
  it("ignores a push with no matching binding", async () => {
    const body = pushBody("nobody/unbound", "main");
    const res = await deliver("push", body, await sign(body));
    expect(res.status).toBe(200);
    expect((await res.json()) as { matched: number }).toMatchObject({ matched: 0 });
  });

  it("enqueues a deploy when a binding matches", async () => {
    const machineId = await enroll("web-gh");

    const bindRes = await SELF.fetch(
      adminReq("/api/bindings", {
        method: "POST",
        body: JSON.stringify({ repo: "Acme/Web", branch: "main", machineId }),
      }),
    );
    expect(bindRes.status).toBe(201);

    // Repo is matched case-insensitively (binding lowercased on write).
    const body = pushBody("acme/web", "main");
    const res = await deliver("push", body, await sign(body));
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
    const machineId = await enroll("web-gh2");
    await SELF.fetch(
      adminReq("/api/bindings", {
        method: "POST",
        body: JSON.stringify({ repo: "acme/api", branch: "main", machineId }),
      }),
    );
    const body = pushBody("acme/api", "feature/x");
    const res = await deliver("push", body, await sign(body));
    expect((await res.json()) as { matched: number }).toMatchObject({ matched: 0 });
  });

  it("ignores tag pushes", async () => {
    const body = JSON.stringify({
      ref: "refs/tags/v1.0.0",
      repository: { full_name: "acme/web" },
      installation: { id: 42 },
    });
    const res = await deliver("push", body, await sign(body));
    const out = (await res.json()) as { ignored?: string };
    expect(out.ignored).toBeDefined();
  });

  it("logs invalid-signature deliveries", async () => {
    await deliver("push", pushBody("acme/bad", "main"), "sha256=deadbeef");
    const res = await SELF.fetch(adminReq("/api/webhooks/deliveries"));
    const { deliveries } = (await res.json()) as {
      deliveries: Array<{ result: string }>;
    };
    expect(deliveries.some((d) => d.result === "invalid signature")).toBe(true);
  });

  it("de-dups a redelivered push (same X-GitHub-Delivery)", async () => {
    const machineId = await enroll("web-dedup");
    await SELF.fetch(
      adminReq("/api/bindings", {
        method: "POST",
        body: JSON.stringify({ repo: "acme/dedup", branch: "main", machineId }),
      }),
    );
    const body = pushBody("acme/dedup", "main");
    const sig = await sign(body);

    const first = await deliver("push", body, sig, "delivery-1");
    expect((await first.json()) as { matched: number }).toMatchObject({ matched: 1 });

    // Same delivery id again → skipped, nothing enqueued.
    const second = await deliver("push", body, sig, "delivery-1");
    expect((await second.json()) as { duplicate?: boolean }).toMatchObject({
      duplicate: true,
    });

    // Only one job exists for the machine.
    const jobsRes = await SELF.fetch(adminReq(`/api/machines/${machineId}/jobs`));
    const { jobs } = (await jobsRes.json()) as { jobs: Array<{ action: string }> };
    expect(jobs.filter((j) => j.action === "deploy")).toHaveLength(1);
  });

  it("coalesces queued deploys to the latest commit while offline", async () => {
    const machineId = await enroll("web-coalesce");
    await SELF.fetch(
      adminReq("/api/bindings", {
        method: "POST",
        body: JSON.stringify({ repo: "acme/coalesce", branch: "main", machineId }),
      }),
    );

    // Agent is offline, so both pushes just queue. Distinct delivery ids so the
    // second isn't de-duped — it's a genuinely newer commit.
    const b1 = pushBody("acme/coalesce", "main", "sha-old");
    const r1 = await deliver("push", b1, await sign(b1), "deliv-old");
    const j1 = ((await r1.json()) as { enqueued: Array<{ jobId: string }> }).enqueued[0].jobId;

    const b2 = pushBody("acme/coalesce", "main", "sha-new");
    const r2 = await deliver("push", b2, await sign(b2), "deliv-new");
    const j2 = ((await r2.json()) as { enqueued: Array<{ jobId: string }> }).enqueued[0].jobId;

    const status = async (id: string) =>
      ((await (await SELF.fetch(adminReq(`/api/jobs/${id}`))).json()) as { status: string })
        .status;

    // The older queued deploy is superseded; only the latest stays queued.
    expect(await status(j1)).toBe("superseded");
    expect(await status(j2)).toBe("queued");
  });

  it("does not coalesce deploys for different repos on the same machine/branch", async () => {
    const machineId = await enroll("multi-repo");
    for (const repo of ["acme/repo-a", "acme/repo-b"]) {
      await SELF.fetch(
        adminReq("/api/bindings", {
          method: "POST",
          body: JSON.stringify({ repo, branch: "main", machineId }),
        }),
      );
    }

    // Both push to main while the agent is offline. Coalescing must key on repo,
    // not branch alone — otherwise repo-b's deploy would supersede repo-a's.
    const ba = pushBody("acme/repo-a", "main", "sha-a");
    const ra = await deliver("push", ba, await sign(ba), "d-a");
    const ja = ((await ra.json()) as { enqueued: Array<{ jobId: string }> }).enqueued[0].jobId;

    const bb = pushBody("acme/repo-b", "main", "sha-b");
    const rb = await deliver("push", bb, await sign(bb), "d-b");
    const jb = ((await rb.json()) as { enqueued: Array<{ jobId: string }> }).enqueued[0].jobId;

    const status = async (id: string) =>
      ((await (await SELF.fetch(adminReq(`/api/jobs/${id}`))).json()) as { status: string })
        .status;

    // Both stay queued — neither repo's deploy is dropped.
    expect(await status(ja)).toBe("queued");
    expect(await status(jb)).toBe("queued");
  });

  it("records deliveries for the admin view", async () => {
    const machineId = await enroll("web-deliv");
    await SELF.fetch(
      adminReq("/api/bindings", {
        method: "POST",
        body: JSON.stringify({ repo: "acme/deliv", branch: "main", machineId }),
      }),
    );
    const body = pushBody("acme/deliv", "main");
    await deliver("push", body, await sign(body));

    const res = await SELF.fetch(adminReq("/api/webhooks/deliveries"));
    expect(res.status).toBe(200);
    const { deliveries } = (await res.json()) as {
      deliveries: Array<{ repo: string; result: string; jobIds: string[]; provider: string }>;
    };
    const d = deliveries.find((x) => x.repo === "acme/deliv");
    expect(d).toBeTruthy();
    expect(d?.result).toBe("enqueued 1");
    expect(d?.jobIds).toHaveLength(1);
    expect(d?.provider).toBe("github");
  });
});
