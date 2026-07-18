import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// The admin UI is a browser app on a different origin, so every non-simple
// request it makes is preflighted. SELF.fetch never preflights, which is how a
// missing PUT in allowMethods passed every functional test and still broke the
// Alerts page with a bare "Failed to fetch" — the request never left the
// browser. These tests assert the preflight contract directly.

function preflight(path: string, method: string): Request {
  return new Request(`https://cp.test${path}`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://admin.test",
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
}

describe("CORS preflight", () => {
  // Every verb the admin UI actually sends.
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    it(`allows ${method}`, async () => {
      const res = await SELF.fetch(preflight("/api/alerts/config", method));
      expect(res.status).toBeLessThan(400);
      const allowed = (res.headers.get("Access-Control-Allow-Methods") ?? "")
        .split(",")
        .map((m) => m.trim().toUpperCase());
      expect(allowed).toContain(method);
    });
  }

  it("allows the Authorization and Content-Type headers", async () => {
    const res = await SELF.fetch(preflight("/api/machines", "POST"));
    const allowed = (res.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase();
    expect(allowed).toContain("authorization");
    expect(allowed).toContain("content-type");
  });
});
