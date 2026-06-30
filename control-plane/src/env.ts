// Worker environment bindings (configured in wrangler.toml).

export interface Env {
  MACHINE_DO: DurableObjectNamespace;
  DB: D1Database;
  /** Admin API bearer token (set via `wrangler secret put ADMIN_TOKEN`). */
  ADMIN_TOKEN: string;
  /** Web-UI login password. Falls back to ADMIN_TOKEN if unset. */
  ADMIN_PASSWORD?: string;
  /** HS256 signing secret for admin session JWTs. Falls back to ADMIN_TOKEN. */
  ADMIN_JWT_SECRET?: string;
  /** Allowed browser origin for CORS (default "*"). e.g. https://admin.example.com */
  ADMIN_UI_ORIGIN?: string;
  HEARTBEAT_SEC: string;
  DEFAULT_JOB_TIMEOUT_SEC: string;
  /**
   * Max age a job may sit queued before it is expired instead of dispatched.
   * Guards against deploying a stale commit when the agent reconnects after a
   * long outage. Default 3600s (1h).
   */
  MAX_QUEUE_AGE_SEC?: string;

  // --- GitHub App (Phase 6, optional) --------------------------------------
  /** Webhook secret used to verify X-Hub-Signature-256. */
  GITHUB_WEBHOOK_SECRET?: string;
  /** Numeric GitHub App id. */
  GITHUB_APP_ID?: string;
  /** App private key in PKCS#8 PEM (BEGIN PRIVATE KEY). */
  GITHUB_APP_PRIVATE_KEY?: string;

  // --- Bitbucket (optional) -------------------------------------------------
  /** Webhook secret used to verify the X-Hub-Signature on deliveries. */
  BITBUCKET_WEBHOOK_SECRET?: string;
  /**
   * Access token (repository/workspace access token or app-password-derived
   * token) used to post commit build-status feedback. Optional — without it the
   * webhook still enqueues deploys, it just can't report status back.
   */
  BITBUCKET_ACCESS_TOKEN?: string;
  /** Bitbucket API base; default https://api.bitbucket.org/2.0 (Cloud). */
  BITBUCKET_API_BASE?: string;
}

/** True when commit-status feedback can be posted (App credentials present). */
export function githubAppConfigured(env: Env): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
}

/** True when Bitbucket build-status feedback can be posted. */
export function bitbucketStatusConfigured(env: Env): boolean {
  return Boolean(env.BITBUCKET_ACCESS_TOKEN);
}

export function heartbeatSec(env: Env): number {
  const n = Number(env.HEARTBEAT_SEC);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export function defaultJobTimeoutSec(env: Env): number {
  const n = Number(env.DEFAULT_JOB_TIMEOUT_SEC);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

export function maxQueueAgeSec(env: Env): number {
  const n = Number(env.MAX_QUEUE_AGE_SEC);
  return Number.isFinite(n) && n > 0 ? n : 3600;
}
