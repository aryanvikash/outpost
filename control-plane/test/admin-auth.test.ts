import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// In tests, ADMIN_PASSWORD/ADMIN_JWT_SECRET are unset, so both fall back to
// ADMIN_TOKEN ("test-admin-token").
const PASSWORD = "test-admin-token";

async function login(password: string): Promise<Response> {
  return SELF.fetch(
    new Request("https://cp.test/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );
}

describe("admin login (JWT)", () => {
  it("rejects a wrong password", async () => {
    expect((await login("nope")).status).toBe(401);
  });

  it("issues a JWT for the right password", async () => {
    const res = await login(PASSWORD);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number };
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it("accepts the issued JWT on admin routes", async () => {
    const { token } = (await (await login(PASSWORD)).json()) as { token: string };
    const res = await SELF.fetch(
      new Request("https://cp.test/api/machines", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("still accepts the static admin token (curl/CI)", async () => {
    const res = await SELF.fetch(
      new Request("https://cp.test/api/machines", {
        headers: { Authorization: `Bearer ${PASSWORD}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a tampered JWT", async () => {
    const { token } = (await (await login(PASSWORD)).json()) as { token: string };
    const tampered = token.slice(0, -3) + "AAA";
    const res = await SELF.fetch(
      new Request("https://cp.test/api/machines", {
        headers: { Authorization: `Bearer ${tampered}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("allows CORS preflight on admin routes", async () => {
    const res = await SELF.fetch(
      new Request("https://cp.test/api/machines", {
        method: "OPTIONS",
        headers: {
          Origin: "https://admin.example.com",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
  });
});
