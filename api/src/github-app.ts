// GitHub App integration helpers.
//
// With a GitHub App, installing it on a repo delivers `push` events natively to
// the App's webhook URL — there is no per-repo webhook to create. This module
// handles:
//   - verifying the X-Hub-Signature-256 HMAC on incoming deliveries,
//   - minting a short-lived App JWT (RS256) and exchanging it for an
//     installation access token (used to post commit-status feedback).
//
// The private key must be PKCS#8 PEM ("BEGIN PRIVATE KEY"). GitHub issues PKCS#1
// ("BEGIN RSA PRIVATE KEY"); convert once with:
//   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in app.pem -out app.pkcs8.pem

const GH_API = "https://api.github.com";
const UA = "outpost-api";

/** Constant-time-ish HMAC-SHA256 verification of a GitHub webhook delivery. */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = "sha256=" + (await hmacSha256Hex(secret, body));
  return timingSafeEqualStr(expected, signatureHeader);
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- App JWT + installation token -------------------------------------------

interface AppCreds {
  appId: string;
  privateKeyPem: string;
}

/** Mint a ~10-minute App JWT signed RS256 with the App private key. */
export async function mintAppJwt(
  creds: AppCreds,
  nowSec: number,
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: nowSec - 60, // allow for clock drift
    exp: nowSec + 9 * 60,
    iss: creds.appId,
  };
  const enc = (o: unknown) => base64url(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;

  const key = await importPkcs8(creds.privateKeyPem);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(sig))}`;
}

/** Exchange the App JWT for an installation access token. */
export async function installationToken(
  creds: AppCreds,
  installationId: number,
  nowSec: number,
): Promise<string> {
  const jwt = await mintAppJwt(creds, nowSec);
  const res = await fetch(
    `${GH_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": UA,
      },
    },
  );
  if (!res.ok) {
    throw new Error(`installation token failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** Post a commit status (e.g. pending/success/failure) for deploy feedback. */
export async function setCommitStatus(
  creds: AppCreds,
  installationId: number,
  repoFullName: string,
  sha: string,
  status: {
    state: "pending" | "success" | "failure" | "error";
    description: string;
    context?: string;
  },
  nowSec: number,
): Promise<void> {
  const token = await installationToken(creds, installationId, nowSec);
  const res = await fetch(`${GH_API}/repos/${repoFullName}/statuses/${sha}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": UA,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state: status.state,
      description: status.description.slice(0, 140),
      context: status.context ?? "outpost/deploy",
    }),
  });
  if (!res.ok) {
    throw new Error(`set commit status failed: ${res.status} ${await res.text()}`);
  }
}

// --- key + base64url helpers -------------------------------------------------

async function importPkcs8(pem: string): Promise<CryptoKey> {
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(
    pem,
  );
  if (!m) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY must be PKCS#8 PEM (BEGIN PRIVATE KEY); convert with openssl pkcs8 -topk8",
    );
  }
  const der = base64ToBytes(m[1].replace(/\s+/g, ""));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
