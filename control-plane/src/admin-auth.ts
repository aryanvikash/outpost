// Admin session auth for the web UI.
//
// The browser must not hold the master ADMIN_TOKEN. Instead the operator logs in
// with a password (POST /api/admin/login) and receives a short-lived HS256 JWT,
// which it sends as a Bearer token on subsequent admin requests. The admin
// middleware accepts EITHER this JWT or the static ADMIN_TOKEN (the latter for
// curl/CI), so programmatic access keeps working.

const DEFAULT_TTL_SEC = 12 * 60 * 60; // 12h

/** Sign an admin session JWT (HS256). */
export async function signAdminJwt(
  secret: string,
  nowSec: number,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<{ token: string; expiresAt: number }> {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = nowSec + ttlSec;
  const payload = { sub: "admin", iat: nowSec, exp, aud: "outpost-admin" };
  const signingInput = `${b64url(json(header))}.${b64url(json(payload))}`;
  const sig = await hmac(secret, signingInput);
  return { token: `${signingInput}.${b64urlBytes(sig)}`, expiresAt: exp * 1000 };
}

/** Verify an admin session JWT. */
export async function verifyAdminJwt(
  token: string,
  secret: string,
  nowSec: number,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  let payload: { exp?: number; aud?: string };
  try {
    payload = JSON.parse(textFrom(b64urlToBytes(parts[1])));
  } catch {
    return false;
  }
  if (payload.aud !== "outpost-admin") return false;
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) return false;

  const expected = await hmac(secret, `${parts[0]}.${parts[1]}`);
  return timingSafeEqualBytes(expected, b64urlToBytes(parts[2]));
}

// --- crypto + encoding -------------------------------------------------------

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function json(o: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(o));
}
function textFrom(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}
function b64url(bytes: Uint8Array): string {
  return b64urlBytes(bytes);
}
function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
