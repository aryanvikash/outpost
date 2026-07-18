// Typed client for the Outpost admin API.

const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN_KEY = "outpost_admin_jwt";

// Auth is observable so <AuthGuard> can react the moment a token appears or a
// 401 clears it — otherwise a session that expires mid-page just renders
// "unauthorized" and strands the user on a signed-out screen.
const listeners = new Set<() => void>();

export function onAuthChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  listeners.forEach((cb) => cb());
}
export function clearToken(): void {
  if (!localStorage.getItem(TOKEN_KEY)) return;
  localStorage.removeItem(TOKEN_KEY);
  listeners.forEach((cb) => cb());
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    throw new ApiError(401, "unauthorized");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  }
  return data as T;
}

// --- types -------------------------------------------------------------------

export interface DeployTarget {
  appDir: string;
  remote: string;
  repoUrl?: string;
  pm2Target: string;
  mode?: "hook" | "pm2";
  hookPath?: string;
}

export interface HookIssue {
  name: string;
  reason: string;
}

export interface Machine {
  id: string;
  name: string;
  status: "online" | "offline";
  agentVersion: string | null;
  createdAt: number;
  lastSeen: number | null;
  revoked: boolean;
  deploy: DeployTarget | null;
  hooks: string[];
  hookIssues: HookIssue[];
}

export interface Job {
  id: string;
  machineId: string;
  action: string;
  params: Record<string, unknown>;
  status: string;
  exitCode: number | null;
  error: string | null;
  createdAt: number;
  dispatchedAt: number | null;
  finishedAt: number | null;
}

export interface LogLine {
  seq: number;
  stream: "stdout" | "stderr";
  chunk: string;
  ts: number;
}

export const ACTIONS = ["healthcheck", "deploy", "restart"] as const;
export type ActionName = (typeof ACTIONS)[number];

// --- endpoints ---------------------------------------------------------------

export function hasApiBase(): boolean {
  return BASE.length > 0;
}
export function apiBase(): string {
  return BASE;
}

export async function login(password: string): Promise<void> {
  const { token } = await request<{ token: string; expiresAt: number }>(
    "/api/admin/login",
    { method: "POST", body: JSON.stringify({ password }) },
  );
  setToken(token);
}

export async function listMachines(): Promise<Machine[]> {
  const { machines } = await request<{ machines: Machine[] }>("/api/machines");
  return machines;
}

export async function revokeMachine(id: string): Promise<void> {
  await request(`/api/machines/${id}/revoke`, { method: "POST" });
}

export async function renameMachine(id: string, name: string): Promise<void> {
  await request(`/api/machines/${id}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function createEnrollToken(input: {
  label?: string;
  uses?: number;
  expiresInMinutes?: number;
}): Promise<{ id: string; token: string; uses: number; expiresAt: number }> {
  return request("/api/enroll-tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function enqueueJob(
  machineId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<{ jobId: string; status: string }> {
  return request(`/api/machines/${machineId}/jobs`, {
    method: "POST",
    body: JSON.stringify({ action, params }),
  });
}

export async function listJobs(machineId: string): Promise<Job[]> {
  const { jobs } = await request<{ jobs: Job[] }>(`/api/machines/${machineId}/jobs`);
  return jobs;
}

export async function getJob(id: string): Promise<Job> {
  return request(`/api/jobs/${id}`);
}

// --- GitHub repo bindings ----------------------------------------------------

export interface Binding {
  id: string;
  repo: string;
  branch: string;
  machineId: string;
  action: string;
  params: Record<string, unknown>;
  createdAt: number;
}

export async function listBindings(): Promise<Binding[]> {
  const { bindings } = await request<{ bindings: Binding[] }>("/api/bindings");
  return bindings;
}

export async function createBinding(input: {
  repo: string;
  branch: string;
  machineId: string;
  action: string;
}): Promise<{ id: string }> {
  return request("/api/bindings", { method: "POST", body: JSON.stringify(input) });
}

export async function deleteBinding(id: string): Promise<void> {
  await request(`/api/bindings/${id}`, { method: "DELETE" });
}

/** wss connect URL and the GitHub webhook URL derived from the API base. */
export function connectWssUrl(): string {
  return apiBase().replace(/^http/, "ws") + "/connect";
}
export function webhookUrl(): string {
  return `${apiBase()}/webhooks/github`;
}
export function bitbucketWebhookUrl(): string {
  return `${apiBase()}/webhooks/bitbucket`;
}

export interface Delivery {
  id: number;
  ts: number;
  event: string;
  provider: "github" | "bitbucket" | "custom" | null;
  repo: string | null;
  branch: string | null;
  sha: string | null;
  matched: number;
  result: string | null;
  jobIds: string[];
}

export async function listDeliveries(): Promise<Delivery[]> {
  const { deliveries } = await request<{ deliveries: Delivery[] }>(
    "/api/webhooks/deliveries",
  );
  return deliveries;
}

// --- trigger hooks -----------------------------------------------------------

export interface TriggerTarget {
  machineId: string;
  action: string;
  params: Record<string, unknown>;
}

export interface Trigger {
  id: string;
  label: string | null;
  targets: TriggerTarget[];
  createdAt: number;
  lastUsedAt: number | null;
}

export async function listTriggers(): Promise<Trigger[]> {
  const { triggers } = await request<{ triggers: Trigger[] }>("/api/triggers");
  return triggers;
}

export async function createTrigger(input: {
  label?: string;
  targets: Array<{ machineId: string; action: string; params?: Record<string, unknown> }>;
}): Promise<{ id: string; token: string; url: string }> {
  return request("/api/triggers", { method: "POST", body: JSON.stringify(input) });
}

export async function deleteTrigger(id: string): Promise<void> {
  await request(`/api/triggers/${id}`, { method: "DELETE" });
}

// --- alerts ------------------------------------------------------------------

export interface Alert {
  id: number;
  ts: number;
  type: "machine_offline" | "job_failed";
  machineId: string | null;
  jobId: string | null;
  status: string | null;
  detail: string | null;
  delivered: boolean;
}

export interface AlertConfig {
  webhookUrl: string;
  events: { machine_offline: boolean; job_failed: boolean };
}

export async function listAlerts(): Promise<Alert[]> {
  const { alerts } = await request<{ alerts: Alert[] }>("/api/alerts");
  return alerts;
}

export async function getAlertConfig(): Promise<AlertConfig> {
  return request("/api/alerts/config");
}

export async function updateAlertConfig(cfg: AlertConfig): Promise<void> {
  await request("/api/alerts/config", { method: "PUT", body: JSON.stringify(cfg) });
}

export async function getJobLogs(id: string): Promise<LogLine[]> {
  const { logs } = await request<{ logs: LogLine[] }>(`/api/jobs/${id}/logs`);
  return logs;
}
