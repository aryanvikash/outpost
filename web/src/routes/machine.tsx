import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Copy,
  Check,
  Play,
  Trash2,
  ScrollText,
  Terminal,
  Pencil,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { listMachines, listJobs, revokeMachine, renameMachine, enqueueJob, ACTIONS } from "../api";
import { timeAgo } from "../util";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

function statusVariant(s: string): "success" | "danger" | "default" {
  if (s === "succeeded") return "success";
  if (["failed", "timed_out", "interrupted", "canceled"].includes(s)) return "danger";
  return "default";
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
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-primary"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function MachineDetailPage() {
  const { machineId } = useParams({ from: "/machines/$machineId" });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const machines = useQuery({ queryKey: ["machines"], queryFn: listMachines, refetchInterval: 5000 });
  const machine = machines.data?.find((m) => m.id === machineId);

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
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Machines
    </Link>
  );

  if (machines.isSuccess && !machine) {
    return (
      <div>
        {backLink}
        <Card className="border-white/5 bg-card/40 backdrop-blur-xl">
          <CardContent className="grid min-h-[240px] place-items-center text-center text-muted-foreground">
            <div>
              <p className="text-sm">This machine doesn't exist (or was revoked).</p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link to="/">Back to machines</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {backLink}
      <Card className="border-white/5 bg-card/40 backdrop-blur-xl shadow-lg">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-6">
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
                  {rename.isPending ? <Loader2 className="animate-spin" /> : null} Save
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full transition-all duration-500",
                    machine?.status === "online"
                      ? "bg-primary shadow-[0_0_12px_2px] shadow-primary/50"
                      : "bg-muted-foreground/40",
                  )}
                />
                <CardTitle className="text-lg font-bold">{machine?.name ?? "Machine"}</CardTitle>
                <button
                  title="Rename"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-primary"
                  onClick={() => {
                    setDraft(machine?.name ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="mt-0.5 flex items-center gap-1.5">
              <code className="font-mono text-[11px] text-muted-foreground">{machineId}</code>
              <CopyIconBtn value={machineId} />
              {machine?.agentVersion && (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  agent {machine.agentVersion}
                </Badge>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              if (confirm("Revoke this device? It won't be able to reconnect.")) revoke.mutate();
            }}
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> Revoke
          </Button>
        </CardHeader>
        <CardContent>
          {machine?.deploy && (
            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1 rounded-xl border border-white/5 bg-secondary/10 p-3.5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Mode</span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {machine.deploy.mode ?? "pm2"}
                </span>
              </div>
              <div className="flex flex-col gap-1 truncate rounded-xl border border-white/5 bg-secondary/10 p-3.5 shadow-sm sm:col-span-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                  {machine.deploy.mode === "hook" ? "Hook Path" : "Git Repository"}
                </span>
                <span className="truncate font-mono text-xs text-primary">
                  {machine.deploy.mode === "hook"
                    ? machine.deploy.hookPath
                    : machine.deploy.repoUrl || (
                        <span className="font-sans font-semibold text-destructive">No git repo at app directory</span>
                      )}
                </span>
              </div>
              <div className="flex flex-col gap-1 truncate rounded-xl border border-white/5 bg-secondary/10 p-3.5 shadow-sm sm:col-span-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">App Directory</span>
                <span className="truncate font-mono text-xs text-foreground/80">
                  {machine.deploy.appDir}
                  {machine.deploy.mode !== "hook" && ` · pm2 ${machine.deploy.pm2Target}`}
                </span>
              </div>
            </div>
          )}
          {machine && machine.hookIssues.length > 0 && (
            <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs shadow-sm backdrop-blur-sm">
              <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-destructive">
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
          <div className="mt-2 flex flex-col gap-3 rounded-xl border border-white/5 bg-secondary/10 p-4 sm:flex-row sm:items-center">
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="border-white/10 bg-card/50 sm:w-[160px]">
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
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="branch" className="border-white/10 bg-card/50" />
            )}
            {action === "restart" && (
              <Input value={app} onChange={(e) => setApp(e.target.value)} placeholder="app (optional)" className="border-white/10 bg-card/50" />
            )}
            <Button
              onClick={() => enqueue.mutate()}
              disabled={enqueue.isPending}
              className="bg-primary text-primary-foreground shadow-[0_0_15px_rgba(var(--primary),0.3)] transition-all hover:bg-primary/90 sm:ml-auto"
            >
              {enqueue.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4 fill-current" />}
              Run Action
            </Button>
          </div>
          {enqueue.isError && <p className="mt-3 text-sm font-medium text-destructive">{(enqueue.error as Error).message}</p>}
          {lastJob && !enqueue.isError && (
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-primary">
              <Check className="h-4 w-4" /> triggered{" "}
              <Link to="/jobs/$jobId" params={{ jobId: lastJob }} className="font-mono underline-offset-4 hover:underline">
                {lastJob}
              </Link>
            </p>
          )}

          {machine && machine.hooks.length > 0 && (
            <div className="mt-8">
              <div className="mb-3 flex items-center gap-2">
                <Terminal className="h-4 w-4 text-primary" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/80">Custom commands</h4>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {machine.hooks.map((h) => (
                  <Button
                    key={h}
                    variant="outline"
                    size="sm"
                    className="border-white/5 bg-secondary/20 shadow-sm transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                    onClick={() => runHookMut.mutate(h)}
                    disabled={runHookMut.isPending}
                  >
                    <Play className="mr-1.5 h-3.5 w-3.5" /> {h}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3 mt-8 flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-primary" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/80">Recent jobs</h4>
          </div>
          <div className="space-y-2.5">
            {jobs.data?.map((j) => (
              <div
                key={j.id}
                className="grid grid-cols-[100px_1fr_auto_auto] items-center gap-4 rounded-xl border border-white/5 bg-secondary/10 p-3 shadow-sm transition-all hover:bg-secondary/20"
              >
                <Badge
                  variant={statusVariant(j.status)}
                  className={cn("justify-center", j.status === "succeeded" && "border-0 bg-primary/15 text-primary hover:bg-primary/25")}
                >
                  {j.status}
                </Badge>
                <span className="text-sm font-medium">{j.action}</span>
                <span className="text-xs font-medium text-muted-foreground/70">{timeAgo(j.createdAt)}</span>
                <Button asChild variant="outline" size="sm" className="h-8 border-white/5 bg-card/50 transition-colors hover:bg-primary/10 hover:text-primary">
                  <Link to="/jobs/$jobId" params={{ jobId: j.id }}>
                    Logs
                  </Link>
                </Button>
              </div>
            ))}
            {jobs.data?.length === 0 && (
              <div className="rounded-xl border border-white/5 bg-secondary/10 py-8 text-center text-sm text-muted-foreground">
                No jobs yet.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
