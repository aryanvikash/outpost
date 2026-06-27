// Action catalog (control-plane view).
//
// The AGENT is the authoritative validator and the only place that maps an
// action to concrete commands (see agent/internal/actions). The control plane
// keeps this lightweight catalog so it can:
//   - reject enqueue of an unknown action early, and
//   - know whether an action is idempotent (drives interrupted-job redelivery).
//
// Keep this list in sync with PROTOCOL.md §7 and the Go action registry.

export interface ActionSpec {
  name: string;
  idempotent: boolean;
  /** Lightweight shape check; the agent performs strict validation. */
  validate(params: Record<string, unknown>): string | null; // null = ok
}

const BRANCH_RE = /^[A-Za-z0-9._/-]{1,255}$/;
const APP_RE = /^[A-Za-z0-9._-]{1,64}$/;
const HOOK_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const ACTIONS: Record<string, ActionSpec> = {
  healthcheck: {
    name: "healthcheck",
    idempotent: true,
    validate: () => null,
  },
  deploy: {
    name: "deploy",
    idempotent: false,
    validate: (p) => {
      const branch = p.branch;
      if (branch === undefined) return null;
      if (typeof branch !== "string" || !BRANCH_RE.test(branch))
        return "invalid branch";
      if (branch.includes("..") || branch.startsWith("-"))
        return "invalid branch";
      return null;
    },
  },
  restart: {
    name: "restart",
    idempotent: true,
    validate: (p) => {
      const app = p.app;
      if (app === undefined) return null;
      if (typeof app !== "string" || !APP_RE.test(app)) return "invalid app";
      return null;
    },
  },
  "run-hook": {
    name: "run-hook",
    idempotent: false,
    validate: (p) => {
      const name = p.name;
      if (typeof name !== "string" || !HOOK_RE.test(name)) return "invalid hook name";
      return null;
    },
  },
};

export function isKnownAction(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACTIONS, name);
}
