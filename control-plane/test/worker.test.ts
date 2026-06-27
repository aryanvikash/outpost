import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  adminReq,
  createEnrollToken,
  generateDeviceKey,
  enrollDevice,
  signConnectJwt,
  connectReq,
} from "./helpers";

describe("admin auth", () => {
  it("rejects requests with no token", async () => {
    const res = await SELF.fetch(new Request("https://cp.test/api/machines"));
    expect(res.status).toBe(401);
  });

  it("rejects a wrong admin token", async () => {
    const res = await SELF.fetch(
      new Request("https://cp.test/api/machines", {
        headers: { Authorization: "Bearer nope" },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("device enrollment", () => {
  it("registers a device's public key and lists it", async () => {
    const dev = await enrollDevice("web-1");
    expect(dev.machineId).toMatch(/^m_/);

    const res = await SELF.fetch(adminReq("/api/machines"));
    const body = (await res.json()) as {
      machines: Array<{ id: string; status: string }>;
    };
    const m = body.machines.find((x) => x.id === dev.machineId);
    expect(m).toBeTruthy();
    expect(m?.status).toBe("offline");
  });

  it("rejects enrollment with no enroll token", async () => {
    const { publicKeyB64 } = await generateDeviceKey();
    const res = await SELF.fetch(
      new Request("https://cp.test/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: publicKeyB64 }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an invalid public key", async () => {
    const token = await createEnrollToken();
    const res = await SELF.fetch(
      new Request("https://cp.test/enroll", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: "not-a-key" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("spends a one-time enroll token (second use fails)", async () => {
    const token = await createEnrollToken({ uses: 1 });
    const enrollWith = async () => {
      const { publicKeyB64 } = await generateDeviceKey();
      return SELF.fetch(
        new Request("https://cp.test/enroll", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ publicKey: publicKeyB64 }),
        }),
      );
    };
    expect((await enrollWith()).status).toBe(201);
    expect((await enrollWith()).status).toBe(401); // token spent
  });

  it("allows a reusable fleet key to enroll multiple devices", async () => {
    const token = await createEnrollToken({ uses: 3 });
    for (let i = 0; i < 3; i++) {
      const { publicKeyB64 } = await generateDeviceKey();
      const res = await SELF.fetch(
        new Request("https://cp.test/enroll", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ publicKey: publicKeyB64 }),
        }),
      );
      expect(res.status).toBe(201);
    }
  });
});

describe("connect: device signature auth", () => {
  it("rejects a missing assertion", async () => {
    const res = await SELF.fetch(connectReq(""));
    expect(res.status).toBe(401);
  });

  it("rejects a non-upgrade request", async () => {
    const res = await SELF.fetch(new Request("https://cp.test/connect"));
    expect(res.status).toBe(426);
  });

  it("rejects a signature from a key not enrolled for that machine", async () => {
    const dev = await enrollDevice("web-imposter");
    const other = await generateDeviceKey(); // different private key
    const jwt = await signConnectJwt({
      machineId: dev.machineId,
      privateKey: other.privateKey,
    });
    const res = await SELF.fetch(connectReq(jwt, dev.machineId));
    expect(res.status).toBe(401);
  });

  it("rejects a valid signature for an unknown machine", async () => {
    const ghost = await generateDeviceKey();
    const jwt = await signConnectJwt({
      machineId: "m_ghost",
      privateKey: ghost.privateKey,
    });
    const res = await SELF.fetch(connectReq(jwt, "m_ghost"));
    expect(res.status).toBe(401);
  });

  it("rejects an expired assertion", async () => {
    const dev = await enrollDevice("web-expired");
    const jwt = await signConnectJwt(dev, { iat: 1000, exp: 2000 }); // ancient
    const res = await SELF.fetch(connectReq(jwt, dev.machineId));
    expect(res.status).toBe(401);
  });

  it("accepts a valid device-signed assertion (101 upgrade)", async () => {
    const dev = await enrollDevice("web-ok");
    const jwt = await signConnectJwt(dev);
    const res = await SELF.fetch(connectReq(jwt, dev.machineId));
    expect(res.status).toBe(101);
  });
});

describe("job enqueue + allowlist enforcement", () => {
  it("rejects an unknown action", async () => {
    const dev = await enrollDevice("web-unknown");
    const res = await SELF.fetch(
      adminReq(`/api/machines/${dev.machineId}/jobs`, {
        method: "POST",
        body: JSON.stringify({ action: "rm-rf", params: {} }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects injection attempts in deploy params", async () => {
    const dev = await enrollDevice("web-inject");
    for (const branch of ["main; rm -rf /", "$(curl evil)", "a..b", "-x"]) {
      const res = await SELF.fetch(
        adminReq(`/api/machines/${dev.machineId}/jobs`, {
          method: "POST",
          body: JSON.stringify({ action: "deploy", params: { branch } }),
        }),
      );
      expect(res.status, `branch=${branch}`).toBe(400);
    }
  });

  it("queues a valid job while the agent is offline and exposes its state", async () => {
    const dev = await enrollDevice("web-queue");
    const res = await SELF.fetch(
      adminReq(`/api/machines/${dev.machineId}/jobs`, {
        method: "POST",
        body: JSON.stringify({ action: "healthcheck", params: {} }),
      }),
    );
    expect(res.status).toBe(202);
    const { jobId, status } = (await res.json()) as { jobId: string; status: string };
    expect(jobId).toMatch(/^j_/);
    expect(status).toBe("queued");

    const jobRes = await SELF.fetch(adminReq(`/api/jobs/${jobId}`));
    const job = (await jobRes.json()) as { status: string; action: string };
    expect(job.action).toBe("healthcheck");
    expect(job.status).toBe("queued");
  });

  it("404s for an unknown job", async () => {
    const res = await SELF.fetch(adminReq("/api/jobs/j_nonexistent"));
    expect(res.status).toBe(404);
  });
});
