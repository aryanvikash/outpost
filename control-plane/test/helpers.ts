import { SELF } from "cloudflare:test";
import { expect } from "vitest";

export const ADMIN = "test-admin-token";

export function adminReq(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${ADMIN}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return new Request(`https://cp.test${path}`, { ...init, headers });
}

export async function createEnrollToken(
  opts: { uses?: number; expiresInMinutes?: number } = {},
): Promise<string> {
  const res = await SELF.fetch(
    adminReq("/api/enroll-tokens", { method: "POST", body: JSON.stringify(opts) }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

export interface Device {
  machineId: string;
  privateKey: CryptoKey;
  publicKeyB64: string;
}

/** Generate an Ed25519 keypair and export the raw public key as base64. */
export async function generateDeviceKey(): Promise<{
  privateKey: CryptoKey;
  publicKeyB64: string;
}> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  return { privateKey: pair.privateKey, publicKeyB64: bytesToBase64(raw) };
}

/** Full device onboarding: create token, generate key, enroll. */
export async function enrollDevice(name = "dev"): Promise<Device> {
  const token = await createEnrollToken();
  const { privateKey, publicKeyB64 } = await generateDeviceKey();
  const res = await SELF.fetch(
    new Request("https://cp.test/enroll", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: publicKeyB64, name }),
    }),
  );
  expect(res.status).toBe(201);
  const { machineId } = (await res.json()) as { machineId: string };
  return { machineId, privateKey, publicKeyB64 };
}

/** Sign a connect JWT exactly as the agent does. */
export async function signConnectJwt(
  dev: { machineId: string; privateKey: CryptoKey },
  overrides: { exp?: number; iat?: number; aud?: string; iss?: string } = {},
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT", kid: dev.machineId };
  const payload = {
    iss: overrides.iss ?? dev.machineId,
    iat: overrides.iat ?? nowSec,
    exp: overrides.exp ?? nowSec + 60,
    aud: overrides.aud ?? "outpost-connect",
  };
  const signingInput = `${b64url(json(header))}.${b64url(json(payload))}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      dev.privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${b64urlBytes(sig)}`;
}

export function connectReq(jwt: string, machineId?: string): Request {
  const headers = new Headers({ Upgrade: "websocket" });
  if (jwt) headers.set("Authorization", `Bearer ${jwt}`);
  if (machineId) headers.set("X-Outpost-Machine-Id", machineId);
  return new Request("https://cp.test/connect", { headers });
}

// --- encoding ---------------------------------------------------------------

function json(o: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(o));
}
function b64url(bytes: Uint8Array): string {
  return b64urlBytes(bytes);
}
function b64urlBytes(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
