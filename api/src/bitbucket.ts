// Bitbucket integration helpers.
//
// Unlike GitHub Apps, Bitbucket uses a plain per-repository webhook (configured
// by the repo admin under Repository settings → Webhooks). When a secret is set,
// Bitbucket signs each delivery with HMAC-SHA256 and sends it in the
// `X-Hub-Signature: sha256=<hex>` header — the SAME scheme GitHub uses, so we
// reuse the verifier. The event type arrives in `X-Event-Key` (e.g. "repo:push").
//
// This module handles:
//   - verifying the delivery signature,
//   - parsing the `repo:push` payload (which carries push.changes[], NOT a single
//     ref like GitHub),
//   - posting commit build-status feedback via the Bitbucket Build Status API.

import { verifyWebhookSignature } from "./github-app";

const DEFAULT_API_BASE = "https://api.bitbucket.org/2.0";
const UA = "outpost-api";

/**
 * Verify a Bitbucket webhook delivery. Bitbucket Cloud (and Server/DC) send
 * `X-Hub-Signature: sha256=<hex>`, identical in format to GitHub's, so we share
 * the HMAC-SHA256 verifier.
 */
export function verifyBitbucketSignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): Promise<boolean> {
  return verifyWebhookSignature(secret, body, signatureHeader);
}

/** One branch update extracted from a Bitbucket `repo:push` payload. */
export interface BitbucketChange {
  branch: string;
  sha: string;
}

interface BitbucketPushPayload {
  repository?: { full_name?: string };
  push?: {
    changes?: Array<{
      new?: {
        type?: string;
        name?: string;
        target?: { hash?: string };
      } | null;
    }>;
  };
}

/** The `workspace/repo` slug from a Bitbucket payload, lowercased to match bindings. */
export function bitbucketRepoFullName(payload: unknown): string {
  const p = payload as BitbucketPushPayload;
  return (p.repository?.full_name ?? "").toLowerCase();
}

/**
 * Extract branch updates from a `repo:push` payload. A single push can touch
 * several branches; tag pushes and branch deletions (`new` is null / not a
 * branch) are skipped.
 */
export function parseBitbucketPush(payload: unknown): BitbucketChange[] {
  const p = payload as BitbucketPushPayload;
  const out: BitbucketChange[] = [];
  for (const change of p.push?.changes ?? []) {
    const n = change.new;
    if (!n || n.type !== "branch") continue; // deletion or tag
    const branch = n.name ?? "";
    const sha = n.target?.hash ?? "";
    if (branch) out.push({ branch, sha });
  }
  return out;
}

/** Map Outpost's job state to a Bitbucket build-status state. */
function buildState(
  state: "pending" | "success" | "failure",
): "INPROGRESS" | "SUCCESSFUL" | "FAILED" {
  if (state === "success") return "SUCCESSFUL";
  if (state === "failure") return "FAILED";
  return "INPROGRESS";
}

/**
 * Post a commit build status (Bitbucket Cloud Build Status API) for deploy
 * feedback. Best-effort; the caller decides whether to await or fire-and-forget.
 *
 *   POST {base}/repositories/{workspace}/{repo}/commit/{sha}/statuses/build
 */
export async function setBuildStatus(
  opts: {
    accessToken: string;
    apiBase?: string;
  },
  repoFullName: string,
  sha: string,
  status: {
    state: "pending" | "success" | "failure";
    description: string;
    key?: string;
    url?: string;
  },
): Promise<void> {
  const base = opts.apiBase ?? DEFAULT_API_BASE;
  const url = `${base}/repositories/${repoFullName}/commit/${sha}/statuses/build`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      key: status.key ?? "outpost-deploy",
      state: buildState(status.state),
      name: "Outpost deploy",
      description: status.description.slice(0, 140),
      url: status.url ?? "",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `bitbucket build status failed: ${res.status} ${await res.text()}`,
    );
  }
}
