import { useMemo, useState } from "react";
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
  RefreshCw,
  RotateCcw,
  Square,
} from "lucide-react";
import {
  listMachines,
  listJobs,
  revokeMachine,
  renameMachine,
  enqueueJob,
  cancelJob,
  getJob,
  ACTIONS,
  type Job,
} from "../api";
import { timeAgo, formatDuration } from "../util";
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

function JobRow({
  job,
  onRetry,
  onCancel,
  retrying,
  canceling,
}: {
  job: Job;
  onRetry: (job: Job) => void;
  onCancel: (job: Job) => void;
  retrying: boolean;
  canceling: boolean;
}) {
  const tone = jobTone(job.status);
  const active = !["succeeded", "failed", "timed_out", "canceled", "interrupted", "superseded", "expired"].includes(job.status);
  const retryable = ["succeeded", "failed", "timed_out", "canceled", "interrupted", "expired"].includes(job.status);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-secondary">
      <Link
        to="/jobs/$jobId"
        params={{ jobId: job.id }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
        <span className={cn("w-24 shrink-0 text-xs", tone.label)}>{job.status}</span>
        <span className="truncate font-medium">{job.action}</span>
        {job.exitCode !== null && job.exitCode !== undefined && (
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            exit {job.exitCode}
          </span>
        )}
        <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground/70 sm:inline">
          {formatDuration(job.createdAt, job.finishedAt)}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {timeAgo(job.createdAt)}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
      </Link>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-muted-foreground hover:text-foreground"
          onClick={() => onCancel(job)}
          disabled={canceling}
          title="Request cancellation"
        >
          {canceling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          <span className="sr-only">Cancel</span>
        </Button>
      )}
      {retryable && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-muted-foreground hover:text-foreground"
          onClick={() => onRetry(job)}
          disabled={retrying}
          title="Re-run with same action + params"
        >
          {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          <span className="sr-only">Re-run</span>
        </Button>
      )}
    </div>
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
  const [jobQuery, setJobQuery] = useState("");
  const [jobStatus, setJobStatus] = useState<string>("all");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const jobs = useQuery({
    queryKey: ["jobs", machineId],
    queryFn: () => listJobs(machineId),
    refetchInterval: 4000,
  });

  // Branch/app validation mirrors the agent (deploy.go / restart.go) so the
  // server doesn't refuse after a click.
  const branchError =
    action === "deploy" && !/^[A-Za-z0-9._/-]{1,255}$/.test(branch)
      ? "Use letters, digits, . _ / - (max 255)."
      : action === "deploy" && (branch.startsWith("-") || branch.includes(".."))
        ? "Must not start with - or contain .."
        : null;
  const appError =
    action === "restart" && app !== "" && !/^[A-Za-z0-9._-]{1,64}$/.test(app)
      ? "Use letters, digits, . _ - (max 64)."
      : null;
  const paramsInvalid = Boolean(branchError || appError);

  const enqueue = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> =
        action === "deploy" ? { branch: branch.trim() || "main" } : action === "restart" && app.trim() ? { app: app.trim() } : {};
      return enqueueJob(machineId, action, params);
    },
    onSuccess: (r) => {
      setLastJob(r.jobId);
      setActionError(null);
      qc.invalidateQueries({ queryKey: ["jobs", machineId] });
    },
    onError: (e) => setActionError((e as Error).message),
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

  const filteredJobs = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    return allJobs.filter((j) => {
      if (jobStatus !== "all" && j.status !== jobStatus) return false;
      if (q && !`${j.id} ${j.action} ${j.status}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allJobs, jobQuery, jobStatus]);

  const handleRetry = async (job: Job) => {
    setRetryingId(job.id);
    try {
      const full = await getJob(job.id);
      const r = await enqueueJob(machineId, full.action, (full.params as Record<string, unknown>) ?? {});
      setLastJob(r.jobId);
      setTab("jobs");
      qc.invalidateQueries({ queryKey: ["jobs", machineId] });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setRetryingId(null);
    }
  };

  const handleCancel = async (job: Job) => {
    setCancelingId(job.id);
    try {
      await cancelJob(job.id);
      qc.invalidateQueries({ queryKey: ["jobs", machineId] });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setCancelingId(null);
    }
  };

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
              <Select value={action} onValueChange={(v) => { setAction(v); setActionError(null); }}>
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
                <div className="sm:max-w-[220px]">
                  <Input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="branch (e.g. main)"
                    aria-label="Branch"
                    aria-invalid={Boolean(branchError)}
                  />
                  {branchError && <p className="mt-1 text-xs text-destructive">{branchError}</p>}
                </div>
              )}
              {action === "restart" && (
                <div className="sm:max-w-[220px]">
                  <Input
                    value={app}
                    onChange={(e) => setApp(e.target.value)}
                    placeholder="app (optional)"
                    aria-label="App name"
                    aria-invalid={Boolean(appError)}
                  />
                  {appError && <p className="mt-1 text-xs text-destructive">{appError}</p>}
                </div>
              )}
              <Button
                onClick={() => enqueue.mutate()}
                disabled={enqueue.isPending || paramsInvalid}
                className="sm:ml-auto"
                title={paramsInvalid ? "Fix invalid input first" : "Enqueue job"}
              >
                {enqueue.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
                )}
                Run action
              </Button>
            </div>

            {(enqueue.isError || actionError) && (
              <p className="mt-2.5 text-sm text-destructive">
                {(enqueue.error as Error | undefined)?.message ?? actionError}
              </p>
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
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={jobQuery}
              onChange={(e) => setJobQuery(e.target.value)}
              placeholder="Search id, action, status…"
              className="h-8 sm:max-w-xs"
              aria-label="Search jobs"
            />
            <div className="flex items-center gap-2">
              <Select value={jobStatus} onValueChange={setJobStatus}>
                <SelectTrigger className="h-8 w-[150px]" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all statuses</SelectItem>
                  <SelectItem value="queued">queued</SelectItem>
                  <SelectItem value="dispatched">dispatched</SelectItem>
                  <SelectItem value="running">running</SelectItem>
                  <SelectItem value="succeeded">succeeded</SelectItem>
                  <SelectItem value="failed">failed</SelectItem>
                  <SelectItem value="timed_out">timed_out</SelectItem>
                  <SelectItem value="canceled">canceled</SelectItem>
                  <SelectItem value="interrupted">interrupted</SelectItem>
                  <SelectItem value="expired">expired</SelectItem>
                  <SelectItem value="superseded">superseded</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => jobs.refetch()}
                disabled={jobs.isFetching}
                title="Refresh job list"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${jobs.isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <span className="text-xs text-muted-foreground">
                {filteredJobs.length}/{allJobs.length}
              </span>
            </div>
          </div>
          {/* The list scrolls in place rather than growing the page: 50 rows is
              ~2000px, and the header/tabs should stay put while you scan it. */}
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="max-h-[60vh] divide-y divide-border overflow-y-auto overscroll-contain">
              {jobs.isLoading && <JobSkeleton />}
              {jobs.isError && (
                <div className="flex items-center justify-between px-4 py-6 text-sm">
                  <span className="text-destructive">{(jobs.error as Error).message}</span>
                  <Button variant="outline" size="sm" onClick={() => jobs.refetch()}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
                  </Button>
                </div>
              )}
              {jobs.isSuccess &&
                filteredJobs.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    onRetry={handleRetry}
                    onCancel={handleCancel}
                    retrying={retryingId === j.id}
                    canceling={cancelingId === j.id}
                  />
                ))}
              {jobs.isSuccess && allJobs.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No jobs yet — run one from Overview and it'll show up here.
                </p>
              )}
              {jobs.isSuccess && allJobs.length > 0 && filteredJobs.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No jobs match — clear search/filter.
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
