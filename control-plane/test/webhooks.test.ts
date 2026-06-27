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

function pushBody(repo: string, branch: string): string {
  return JSON.stringify({
    ref: `refs/heads/${branch}`,
    after: "abc123def456",
    repository: { full_name: repo },
    installation: { id: 42 },
  });
}

async function deliver(event: string, body: string, sig?: string): Promise<Response> {
  const headers = new Headers({
    "X-GitHub-Event": event,
    "Content-Type": "application/json",
  });
  if (sig !== undefined) headers.set("X-Hub-Signature-256", sig);
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
      deliveries: Array<{ repo: string; result: string; jobIds: string[] }>;
    };
    const d = deliveries.find((x) => x.repo === "acme/deliv");
    expect(d).toBeTruthy();
    expect(d?.result).toBe("enqueued 1");
    expect(d?.jobIds).toHaveLength(1);
  });
});
