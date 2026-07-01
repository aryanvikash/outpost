// Device authentication: verify the short-lived EdDSA JWT an agent signs with
// its device private key on every connect, against the public key we stored at
// enrollment. No shared secret ever crosses the wire.
//
// JWT shape (see PROTOCOL.md §2):
//   header  { "alg": "EdDSA", "typ": "JWT", "kid": "<machineId>" }
//   payload { "iss": "<machineId>", "iat": <sec>, "exp": <sec>, "aud": "outpost-connect" }

export const CONNECT_AUDIENCE = "outpost-connect";

/** Max accepted lifetime/skew for a connect JWT (seconds). */
const MAX_LIFETIME_SEC = 300;
const CLOCK_SKEW_SEC = 60;

interface JwtParts {
  header: { alg?: string; typ?: string; kid?: string };
  payload: { iss?: string; iat?: number; exp?: number; aud?: string };
  signingInput: string;
  signature: Uint8Array;
}

/** Parse a JWT without verifying. Returns null on structural garbage. */
export function parseJwt(jwt: string): JwtParts | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(textFrom(b64urlToBytes(parts[0])));
    const payload = JSON.parse(textFrom(b64urlToBytes(parts[1])));
    return {
      header,
      payload,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: b64urlToBytes(parts[2]),
    };
  } catch {
    return null;
  }
}

/** The unverified machine id (kid), used to look up the public key. */
export function jwtMachineId(jwt: string): string | null {
  const p = parseJwt(jwt);
  return p?.header.kid ?? p?.payload.iss ?? null;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Verify a connect JWT against a base64 raw Ed25519 public key and validate its
 * claims. `nowSec` is the current time in seconds.
 */
export async function verifyConnectJwt(
  jwt: string,
  publicKeyB64: string,
  machineId: string,
  nowSec: number,
): Promise<VerifyResult> {
  const p = parseJwt(jwt);
  if (!p) return { ok: false, error: "malformed jwt" };
  if (p.header.alg !== "EdDSA") return { ok: false, error: "bad alg" };
  if (p.payload.iss !== machineId || (p.header.kid && p.header.kid !== machineId)) {
    return { ok: false, error: "issuer mismatch" };
  }
  if (p.payload.aud !== CONNECT_AUDIENCE) return { ok: false, error: "bad audience" };

  const iat = p.payload.iat ?? 0;
  const exp = p.payload.exp ?? 0;
  if (exp <= nowSec - CLOCK_SKEW_SEC) return { ok: false, error: "expired" };
  if (iat > nowSec + CLOCK_SKEW_SEC) return { ok: false, error: "issued in future" };
  if (exp - iat > MAX_LIFETIME_SEC) return { ok: false, error: "lifetime too long" };

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(publicKeyB64),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, error: "bad stored public key" };
  }

  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    p.signature,
    new TextEncoder().encode(p.signingInput),
  );
  return valid ? { ok: true } : { ok: false, error: "bad signature" };
}

/** Validate a base64 raw Ed25519 public key submitted at enrollment. */
export function isValidPublicKey(b64: string): boolean {
  try {
    return base64ToBytes(b64).length === 32;
  } catch {
    return false;
  }
}

// --- encoding helpers --------------------------------------------------------

function textFrom(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(b64 + "===".slice((b64.length + 3) % 4));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
