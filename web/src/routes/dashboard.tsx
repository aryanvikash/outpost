import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
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
import {
  listMachines,
  listJobs,
  revokeMachine,
  renameMachine,
  createEnrollToken,
  enqueueJob,
  apiBase,
  ACTIONS,
  type Machine,
} from "../api";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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
      className="text-muted-foreground hover:text-primary transition-colors p-1 rounded-md hover:bg-secondary/40"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function DashboardPage() {
  const navigate = useNavigate({ from: "/" });
  const { machine: selected } = useSearch({ from: "/" });
  const setSelected = (id: string | null) =>
    navigate({ search: { machine: id ?? undefined }, replace: false });
  const [enrollOpen, setEnrollOpen] = useState(false);

  const machines = useQuery({
    queryKey: ["machines"],
    queryFn: listMachines,
    refetchInterval: 5000,
  });

  const all = machines.data ?? [];
  const visible = all.filter((m) => !m.revoked); // hide revoked from the main view
  const revokedCount = all.length - visible.length;
  const online = visible.filter((m) => m.status === "online").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Machines</h1>
        <div className="flex gap-2.5">
          <Stat label="machines" value={visible.length} />
          <Stat label="online" value={online} live />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="border-white/5 bg-card/40 backdrop-blur-xl shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-lg">Machines</CardTitle>
            <Button size="sm" onClick={() => setEnrollOpen(true)} className="bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-all">
              <Plus className="mr-1 h-4 w-4" /> Add Machine
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {machines.isLoading && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
              </p>
            )}
            {machines.isError && (
              <p className="text-sm text-red-400">{(machines.error as Error).message}</p>
            )}
            {visible.map((m) => (
              <MachineRow
                key={m.id}
                m={m}
                selected={selected === m.id}
                onSelect={() => setSelected(m.id)}
              />
            ))}
            {!machines.isLoading && visible.length === 0 && (
              <div className="grid place-items-center gap-3 py-12 text-center text-muted-foreground">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-2 opacity-80">
                  <rect x="8" y="8" width="48" height="48" rx="12" className="fill-primary/5 stroke-primary/30" strokeWidth="1.5" strokeDasharray="4 4"/>
                  <path d="M32 24V40 M24 32H40" className="stroke-primary/70" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <p className="text-sm font-medium">No machines connected yet.</p>
                <Button size="sm" variant="default" className="mt-2 bg-primary/10 text-primary hover:bg-primary/20" onClick={() => setEnrollOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Add your first machine
                </Button>
              </div>
            )}
            {revokedCount > 0 && (
              <p className="pt-1 text-center text-[11px] text-muted-foreground/50">
                {revokedCount} revoked hidden
              </p>
            )}
          </CardContent>
        </Card>

        {selected && visible.some((m) => m.id === selected) ? (
          <MachinePanel
            key={selected}
            machine={visible.find((m) => m.id === selected)}
            machineId={selected}
          />
        ) : (
          <Card className="border-white/5 bg-card/20 backdrop-blur-xl">
            <CardContent className="grid min-h-[400px] place-items-center p-6 text-center text-muted-foreground">
              <div className="flex flex-col items-center">
                <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-6 opacity-80">
                  <rect x="20" y="20" width="80" height="80" rx="24" className="fill-primary/5 stroke-primary/20" strokeWidth="1.5" strokeDasharray="6 6"/>
                  <circle cx="60" cy="60" r="16" className="fill-primary/10 stroke-primary/40" strokeWidth="1.5"/>
                  <circle cx="60" cy="60" r="4" className="fill-primary/60"/>
                  <path d="M60 30L60 40 M60 80L60 90 M30 60L40 60 M80 60L90 60" className="stroke-primary/50" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <h3 className="mb-2 text-lg font-semibold text-foreground/90">Awaiting Selection</h3>
                <p className="text-sm text-muted-foreground/80 max-w-[260px] leading-relaxed">Select a machine from the list to view its details, run jobs, and check history.</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <EnrollDialog open={enrollOpen} onOpenChange={setEnrollOpen} />
    </div>
  );
}

function Stat({ label, value, live }: { label: string; value: number; live?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 rounded-xl border border-white/5 bg-card/40 px-4 py-2 backdrop-blur-md shadow-sm">
      <span className={cn("text-lg font-bold tabular-nums", live && value > 0 && "text-primary drop-shadow-[0_0_8px_rgba(var(--primary),0.4)]")}>
        {value}
      </span>
      <span className="text-xs font-medium text-muted-foreground/80">{label}</span>
    </div>
  );
}

function MachineRow({
  m,
  selected,
  onSelect,
}: {
  m: Machine;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-2 rounded-xl border border-white/5 bg-secondary/20 p-4 text-left transition-all hover:bg-secondary/40 hover:shadow-md",
        selected && "border-primary/40 bg-primary/10 shadow-[0_4px_20px_-4px_rgba(var(--primary),0.2)] hover:bg-primary/15",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full transition-all duration-500",
            m.status === "online"
              ? "bg-primary shadow-[0_0_12px_2px] shadow-primary/50"
              : "bg-muted-foreground/40",
          )}
        />
        <span className="font-semibold">{m.name}</span>
        {m.revoked && (
          <Badge variant="danger" className="ml-1 px-1.5 py-0">
            revoked
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground/70">{timeAgo(m.lastSeen)}</span>
      </div>
      <div className="flex items-center gap-2">
        <code className="rounded border border-border bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {m.id}
        </code>
        <span className="text-[11px] text-muted-foreground/60">{m.agentVersion ?? "—"}</span>
      </div>
    </button>
  );
}

function MachinePanel({ machine, machineId }: { machine?: Machine; machineId: string }) {
  const qc = useQueryClient();
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["machines"] }),
  });

  const rename = useMutation({
    mutationFn: (name: string) => renameMachine(machineId, name),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["machines"] });
    },
  });

  return (
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
                className="text-muted-foreground hover:text-primary transition-colors p-1 rounded-md hover:bg-secondary/40"
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
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl border border-white/5 bg-secondary/10 flex flex-col gap-1 shadow-sm">
              <span className="text-[10px] uppercase font-bold text-muted-foreground/80 tracking-wider">Mode</span>
              <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {machine.deploy.mode ?? "pm2"}
              </span>
            </div>
            <div className="p-3.5 rounded-xl border border-white/5 bg-secondary/10 flex flex-col gap-1 sm:col-span-2 shadow-sm truncate">
              <span className="text-[10px] uppercase font-bold text-muted-foreground/80 tracking-wider">
                {machine.deploy.mode === "hook" ? "Hook Path" : "Git Repository"}
              </span>
              <span className="text-xs font-mono text-primary truncate">
                {machine.deploy.mode === "hook" 
                  ? machine.deploy.hookPath 
                  : machine.deploy.repoUrl || <span className="text-destructive font-sans font-semibold">No git repo at app directory</span>}
              </span>
            </div>
            <div className="p-3.5 rounded-xl border border-white/5 bg-secondary/10 flex flex-col gap-1 sm:col-span-3 shadow-sm truncate">
              <span className="text-[10px] uppercase font-bold text-muted-foreground/80 tracking-wider">App Directory</span>
              <span className="text-xs font-mono text-foreground/80 truncate">
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center p-4 rounded-xl border border-white/5 bg-secondary/10 mt-2">
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="sm:w-[160px] bg-card/50 border-white/10">
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
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="branch" className="bg-card/50 border-white/10" />
          )}
          {action === "restart" && (
            <Input value={app} onChange={(e) => setApp(e.target.value)} placeholder="app (optional)" className="bg-card/50 border-white/10" />
          )}
          <Button onClick={() => enqueue.mutate()} disabled={enqueue.isPending} className="sm:ml-auto bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_rgba(var(--primary),0.3)] transition-all">
            {enqueue.isPending ? <Loader2 className="animate-spin mr-1.5 h-4 w-4" /> : <Play className="mr-1.5 h-4 w-4 fill-current" />}
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
            <div className="flex items-center gap-2 mb-3">
              <Terminal className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/80">
                Custom commands
              </h4>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {machine.hooks.map((h) => (
                <Button
                  key={h}
                  variant="outline"
                  size="sm"
                  className="bg-secondary/20 border-white/5 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-all shadow-sm"
                  onClick={() => runHookMut.mutate(h)}
                  disabled={runHookMut.isPending}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" /> {h}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 mb-3 flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/80">
            Recent jobs
          </h4>
        </div>
        <div className="space-y-2.5">
          {jobs.data?.map((j) => (
            <div
              key={j.id}
              className="grid grid-cols-[100px_1fr_auto_auto] items-center gap-4 rounded-xl border border-white/5 bg-secondary/10 p-3 hover:bg-secondary/20 transition-all shadow-sm"
            >
              <Badge variant={statusVariant(j.status)} className={cn("justify-center", j.status === 'succeeded' && "bg-primary/15 text-primary border-0 hover:bg-primary/25")}>
                {j.status}
              </Badge>
              <span className="font-medium text-sm">{j.action}</span>
              <span className="text-xs font-medium text-muted-foreground/70">{timeAgo(j.createdAt)}</span>
              <Button asChild variant="outline" size="sm" className="bg-card/50 border-white/5 hover:bg-primary/10 hover:text-primary transition-colors h-8">
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
  );
}

function EnrollDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [result, setResult] = useState<{ token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () => createEnrollToken({ uses: 1, expiresInMinutes: 60 }),
    onSuccess: (r) => setResult(r),
  });

  const wssUrl = apiBase().replace(/^http/, "ws") + "/connect";
  const installCmd = result
    ? `curl -fsSL https://raw.githubusercontent.com/aryanvikash/outpost/main/install.sh | \\\n  OUTPOST_URL=${wssUrl} OUTPOST_ENROLL_TOKEN=${result.token} sh`
    : "";

  function close(v: boolean) {
    onOpenChange(v);
    if (!v) {
      setResult(null);
      setCopied(false);
      create.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a machine</DialogTitle>
          <DialogDescription>
            {result
              ? "Run this on the new server. The token is one-time and shown once."
              : "Generate a one-time connect token (valid 60 minutes)."}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {create.isPending && <Loader2 className="animate-spin mr-1.5 h-4 w-4" />}
              Generate token
            </Button>
          </div>
        ) : (
          <>
            <div className="relative group">
              <pre className="whitespace-pre-wrap break-all rounded-xl border border-white/5 bg-secondary/20 p-4 pr-12 font-mono text-xs leading-relaxed text-primary/95 shadow-inner">
                {installCmd}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-3.5 right-3.5 h-8 w-8 text-muted-foreground hover:bg-secondary/40 hover:text-primary opacity-70 group-hover:opacity-100 transition-all"
                onClick={() => {
                  navigator.clipboard.writeText(installCmd);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex justify-end gap-2.5 mt-2">
              <Button
                variant="outline"
                className="bg-secondary/20 border-white/5 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-all"
                onClick={() => {
                  navigator.clipboard.writeText(installCmd);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                {copied ? "Copied" : "Copy command"}
              </Button>
              <Button onClick={() => close(false)} className="bg-primary hover:bg-primary/95 text-primary-foreground shadow-[0_0_15px_rgba(var(--primary),0.35)] transition-all font-semibold">Done</Button>
            </div>
          </>
        )}
        {create.isError && <p className="text-sm text-destructive font-semibold">{(create.error as Error).message}</p>}
      </DialogContent>
    </Dialog>
  );
}
