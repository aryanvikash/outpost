import { describe, it, expect } from "vitest";
import { mintAppJwt, verifyWebhookSignature } from "../src/github-app";

function toPem(der: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(der));
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

describe("github app JWT", () => {
  it("mints a verifiable RS256 JWT from a PKCS#8 PEM key", async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = (await crypto.subtle.exportKey(
      "pkcs8",
      pair.privateKey,
    )) as ArrayBuffer;
    const pem = toPem(pkcs8);

    const nowSec = 1_700_000_000;
    const jwt = await mintAppJwt({ appId: "12345", privateKeyPem: pem }, nowSec);

    const [h, p, s] = jwt.split(".");
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as {
      iss: string;
      iat: number;
      exp: number;
    };
    expect(payload.iss).toBe("12345");
    expect(payload.iat).toBeLessThan(nowSec);
    expect(payload.exp).toBeGreaterThan(nowSec);

    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pair.publicKey,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it("rejects a PKCS#1 key with a helpful error", async () => {
    const pkcs1 = "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----";
    await expect(
      mintAppJwt({ appId: "1", privateKeyPem: pkcs1 }, 1),
    ).rejects.toThrow(/PKCS#8/);
  });
});

describe("webhook signature verification", () => {
  const secret = "s3cr3t";
  const body = '{"hello":"world"}';

  async function sig(b: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const out = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(b));
    return (
      "sha256=" +
      [...new Uint8Array(out)].map((x) => x.toString(16).padStart(2, "0")).join("")
    );
  }

  it("accepts a correct signature", async () => {
    expect(await verifyWebhookSignature(secret, body, await sig(body))).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const good = await sig(body);
    expect(await verifyWebhookSignature(secret, body + "x", good)).toBe(false);
  });

  it("rejects a null header", async () => {
    expect(await verifyWebhookSignature(secret, body, null)).toBe(false);
  });
});
