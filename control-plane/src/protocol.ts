// Outpost wire protocol — TypeScript types.
//
// This file mirrors PROTOCOL.md (the source of truth). Keep it in sync with
// agent/internal/protocol/protocol.go. Protocol version: 1.

export const PROTOCOL_VERSION = 1 as const;

/** Maximum application message size: 1 MiB. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

export type LogStream = "stdout" | "stderr";

// --- Agent → control plane ---------------------------------------------------

export interface DeployConfig {
  appDir: string;
  remote: string;
  repoUrl?: string;
  pm2Target: string;
  mode?: "hook" | "pm2";
  hookPath?: string;
}

export interface HelloMessage {
  type: "hello";
  version: number;
  machineId: string;
  agentVersion: string;
  actions: string[];
  deploy?: DeployConfig;
  hooks?: string[];
}

export interface HostStats {
  uptimeSec?: number;
  load1?: number;
  memUsedMb?: number;
  memTotalMb?: number;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  version: number;
  ts: number;
  stats?: HostStats;
}

export interface LogMessage {
  type: "log";
  version: number;
  jobId: string;
  stream: LogStream;
  seq: number;
  chunk: string;
}

export interface ResultMessage {
  type: "result";
  version: number;
  jobId: string;
  exitCode: number;
  finishedAt: number;
  error?: string | null;
}

export interface AckMessage {
  type: "ack";
  version: number;
  jobId: string;
}

export type AgentMessage =
  | HelloMessage
  | HeartbeatMessage
  | LogMessage
  | ResultMessage
  | AckMessage;

// --- Control plane → agent ---------------------------------------------------

export interface JobMessage {
  type: "job";
  version: number;
  jobId: string;
  action: string;
  params: Record<string, unknown>;
  timeoutSec: number;
}

export interface CancelMessage {
  type: "cancel";
  version: number;
  jobId: string;
}

export interface WelcomeMessage {
  type: "welcome";
  version: number;
  heartbeatSec: number;
  serverTime: number;
}

export type ServerMessage = JobMessage | CancelMessage | WelcomeMessage;

// --- Helpers -----------------------------------------------------------------

/** Synthetic agent-level exit codes (mirrors PROTOCOL.md §4). */
export const ExitCode = {
  Timeout: 124,
  StartFailed: 125,
  Refused: 126,
  Terminated: 130,
} as const;

/** Parse + minimally validate an inbound agent message. Returns null on garbage. */
export function parseAgentMessage(raw: string): AgentMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const msg = obj as Record<string, unknown>;
  if (typeof msg.type !== "string") return null;
  if (typeof msg.version !== "number") return null;
  switch (msg.type) {
    case "hello":
    case "heartbeat":
    case "log":
    case "result":
    case "ack":
      return msg as unknown as AgentMessage;
    default:
      return null;
  }
}
