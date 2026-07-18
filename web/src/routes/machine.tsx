import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Copy,
  Check,
  Play,
  Trash2,
  Pencil,
  Loader2,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import {
  listMachines,
  listJobs,
  revokeMachine,
  renameMachine,
  enqueueJob,
  ACTIONS,
  type Job,
} from "../api";
import { timeAgo } from "../util";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

/** The API returns at most this many; surfaced so the UI can say so. */
const JOB_API_LIMIT = 50;

/** Reserved hook name the Deploy action and git pushes delegate to. */
const DEPLOY_HOOK = "deploy";

/** The agent only reports the path of the `deploy` hook, but every hook lives
 *  beside it — so the directory, not that one file, is the useful fact. */
function hooksDirOf(hookPath: string | undefined): string {
  if (!hookPath) return "—";
  const i = hookPath.lastIndexOf("/");
  return i > 0 ? hookPath.slice(0, i) : hookPath;
}

/** Terminal job states read as outcomes; everything else is in-flight. */
function jobTone(status: string): { dot: string; label: string } {
  if (status === "succeeded") return { dot: "bg-emerald-500", label: "text-muted-foreground" };
  if (["failed", "timed_out", "interrupted", "canceled"].includes(status))
    return { dot: "bg-destructive", label: "text-destructive" };
  if (status === "running") return { dot: "bg-foreground animate-pulse", label: "text-foreground" };
  return { dot: "bg-muted-foreground/50", label: "text-muted-foreground" };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** Label/value row. A one-word value doesn't deserve its own card. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 px-4 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-[13px]">{children}</dd>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const tone = jobTone(job.status);
  return (
    <Link
      to="/jobs/$jobId"
      params={{ jobId: job.id }}
      className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-secondary"
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
      <span className={cn("w-24 shrink-0 text-xs", tone.label)}>{job.status}</span>
      <span className="truncate font-medium">{job.action}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        {timeAgo(job.createdAt)}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
    </Link>
  );
}

function JobSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
          <span className="h-3 w-20 animate-pulse rounded bg-secondary" />
          <span className="h-3 w-24 animate-pulse rounded bg-secondary" />
        </div>
      ))}
    </>
  );
}

function CopyIconBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      title="Copy machine ID"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function MachineDetailPage() {
  const { machineId } = useParams({ from: "/machines/$machineId" });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const machines = useQuery({ queryKey: ["machines"], queryFn: listMachines, refetchInterval: 5000 });
  const machine = machines.data?.find((m) => m.id === machineId);

  const [tab, setTab] = useState("overview");
  const [action, setAction] = useState<string>("healthcheck");
  const [branch, setBranch] = useState("main");
  const [app, setApp] = useState("");
  const [lastJob, setLastJob] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const jobs = useQuery({
    queryKey: ["jobs", machineId],
    queryFn: () => listJobs(machineId),
    refetchInterval: 4000,
  });

  const enqueue = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> =
        action === "deploy" ? { branch } : action === "restart" && app ? { app } : {};
      return enqueueJob(machineId, action, params);
    },
    onSuccess: (r) => {
      setLastJob(r.jobId);
      qc.invalidateQueries({ queryKey: ["jobs", machineId] });
    },
  });

  const runHookMut = useMutation({
    mutationFn: (name: string) => enqueueJob(machineId, "run-hook", { name }),
    onSuccess: (r) => {
      setLastJob(r.jobId);
      qc.invalidateQueries({ queryKey: ["jobs", machineId] });
    },
  });

  const revoke = useMutation({
    mutationFn: () => revokeMachine(machineId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["machines"] });
      navigate({ to: "/" });
    },
  });

  const rename = useMutation({
    mutationFn: (name: string) => renameMachine(machineId, name),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["machines"] });
    },
  });

  const backLink = (
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Machines
    </Link>
  );

  if (machines.isSuccess && !machine) {
    return (
      <div>
        {backLink}
        <div className="mt-6 rounded-lg border border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            This machine doesn't exist, or it was revoked.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/">Back to machines</Link>
          </Button>
        </div>
      </div>
    );
  }

  const online = machine?.status === "online";
  const allJobs = jobs.data ?? [];
  const atApiLimit = allJobs.length >= JOB_API_LIMIT;

  return (
    <div>
      {backLink}

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {editing ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) rename.mutate(draft.trim());
              }}
            >
              <Input
                value={draft}
                autoFocus
                maxLength={64}
                onChange={(e) => setDraft(e.target.value)}
                className="h-8 w-52"
              />
              <Button size="sm" type="submit" disabled={rename.isPending || !draft.trim()}>
                {rename.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="group flex items-center gap-2.5">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {machine?.name ?? "Machine"}
              </h1>
              <button
                title="Rename"
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => {
                  setDraft(machine?.name ?? "");
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  online ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
              <span className={online ? "text-emerald-500" : undefined}>
                {online ? "online" : "offline"}
              </span>
            </span>
            {machine?.lastSeen && (
              <>
                <span aria-hidden>·</span>
                <span>last seen {timeAgo(machine.lastSeen)}</span>
              </>
            )}
            {machine?.agentVersion && (
              <>
                <span aria-hidden>·</span>
                <span>agent {machine.agentVersion}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="flex items-center gap-0.5">
              <code className="font-mono">{machineId}</code>
              <CopyIconBtn value={machineId} />
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            if (confirm("Revoke this device? It won't be able to reconnect.")) revoke.mutate();
          }}
        >
          <Trash2 className="mr-1.5 h-4 w-4" /> Revoke
        </Button>
      </div>

      {/* The only thing above the tabs, and only when something is wrong: a
          broken hook must not be hidden behind a tab you aren't looking at. */}
      {machine && machine.hookIssues.length > 0 && (
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs">
          <p className="mb-1.5 flex items-center gap-1.5 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {machine.hookIssues.length} hook
            {machine.hookIssues.length > 1 ? "s" : ""} found but not runnable
          </p>
          <ul className="space-y-1 text-destructive/80">
            {machine.hookIssues.map((h) => (
              <li key={h.name}>
                <code className="font-mono text-destructive">{h.name}</code> — {h.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Tabs
        className="mt-8"
        value={tab}
        onChange={setTab}
        items={[
          { id: "overview", label: "Overview" },
          {
            id: "jobs",
            label: "Jobs",
            meta: allJobs.length > 0 ? `${allJobs.length}${atApiLimit ? "+" : ""}` : undefined,
          },
        ]}
      />

      <div className="mt-6">
        <TabPanel id="overview" active={tab === "overview"}>
          <Section title="Run an action">
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="sm:w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {action === "deploy" && (
                <Input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="branch"
                  className="sm:max-w-[220px]"
                />
              )}
              {action === "restart" && (
                <Input
                  value={app}
                  onChange={(e) => setApp(e.target.value)}
                  placeholder="app (optional)"
                  className="sm:max-w-[220px]"
                />
              )}
              <Button
                onClick={() => enqueue.mutate()}
                disabled={enqueue.isPending}
                className="sm:ml-auto"
              >
                {enqueue.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
                )}
                Run action
              </Button>
            </div>

            {enqueue.isError && (
              <p className="mt-2.5 text-sm text-destructive">{(enqueue.error as Error).message}</p>
            )}
            {lastJob && !enqueue.isError && (
              <p className="mt-2.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-emerald-500" /> Queued{" "}
                <Link
                  to="/jobs/$jobId"
                  params={{ jobId: lastJob }}
                  className="font-mono text-foreground underline-offset-4 hover:underline"
                >
                  {lastJob}
                </Link>
              </p>
            )}
          </Section>

          {machine && machine.hooks.length > 0 && (
            <Section title="Hooks">
              <div className="divide-y divide-border rounded-lg border border-border">
                {machine.hooks.map((h) => (
                  <div key={h} className="flex items-center gap-3 px-4 py-2.5">
                    <code className="font-mono text-[13px]">{h}</code>
                    {/* `deploy` is a reserved name: the Deploy action and an
                        incoming git push both delegate to it. Every other hook
                        only runs when triggered by name. */}
                    {h === DEPLOY_HOOK && (
                      <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        runs on push
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7"
                      onClick={() => runHookMut.mutate(h)}
                      disabled={runHookMut.isPending}
                    >
                      <Play className="mr-1.5 h-3 w-3 fill-current" /> Run
                    </Button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {machine?.deploy && (
            <Section title="Configuration">
              {/* Only the fields the active mode actually uses. In hook mode the
                  agent still reports appDir/repoUrl/pm2Target, but deploy.go
                  returns into the hook script before any of them are read — so
                  showing them describes a code path that never runs. */}
              <dl className="divide-y divide-border rounded-lg border border-border">
                <Field label="Mode">{machine.deploy.mode ?? "pm2"}</Field>
                {machine.deploy.mode === "hook" ? (
                  <Field label="Hooks directory">{hooksDirOf(machine.deploy.hookPath)}</Field>
                ) : (
                  <>
                    <Field label="Git repository">
                      {machine.deploy.repoUrl || (
                        <span className="font-sans text-destructive">
                          No git repo at app directory
                        </span>
                      )}
                    </Field>
                    <Field label="App directory">{machine.deploy.appDir}</Field>
                    <Field label="Branch remote">{machine.deploy.remote}</Field>
                    <Field label="pm2 target">{machine.deploy.pm2Target}</Field>
                  </>
                )}
              </dl>
              {machine.deploy.mode === "hook" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  In hook mode Outpost only runs the script — the app directory
                  and restart command are defined inside it.
                </p>
              )}
            </Section>
          )}

          {!machine?.deploy && (
            <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
              This agent hasn't reported a deploy configuration yet.
            </p>
          )}
        </TabPanel>

        <TabPanel id="jobs" active={tab === "jobs"}>
          {/* The list scrolls in place rather than growing the page: 50 rows is
              ~2000px, and the header/tabs should stay put while you scan it. */}
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="max-h-[60vh] divide-y divide-border overflow-y-auto overscroll-contain">
              {jobs.isLoading && <JobSkeleton />}
              {allJobs.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
              {jobs.data?.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No jobs yet — run one from Overview and it'll show up here.
                </p>
              )}
            </div>
          </div>
          {atApiLimit && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the {JOB_API_LIMIT} most recent jobs.
            </p>
          )}
        </TabPanel>
      </div>
    </div>
  );
}
