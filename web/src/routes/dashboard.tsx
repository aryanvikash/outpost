import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Copy,
  Check,
  Play,
  Trash2,
  Server,
  ScrollText,
  Terminal,
  Pencil,
  Loader2,
  RadioTower,
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
  const online = all.filter((m) => m.status === "online").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Fleet</h1>
        <div className="flex gap-2.5">
          <Stat label="machines" value={all.length} />
          <Stat label="online" value={online} live />
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Machines</CardTitle>
            <Button size="sm" onClick={() => setEnrollOpen(true)}>
              <Plus /> Enroll
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {machines.isLoading && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
              </p>
            )}
            {machines.isError && (
              <p className="text-sm text-red-400">{(machines.error as Error).message}</p>
            )}
            {all.map((m) => (
              <MachineRow
                key={m.id}
                m={m}
                selected={selected === m.id}
                onSelect={() => setSelected(m.id)}
              />
            ))}
            {machines.data?.length === 0 && (
              <div className="grid place-items-center gap-2 py-10 text-center text-muted-foreground">
                <Server className="h-7 w-7 opacity-50" />
                <p className="text-sm">No machines yet.</p>
                <Button size="sm" variant="outline" onClick={() => setEnrollOpen(true)}>
                  <Plus /> Enroll your first
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {selected ? (
          <MachinePanel
            key={selected}
            machine={all.find((m) => m.id === selected)}
            machineId={selected}
          />
        ) : (
          <Card>
            <CardContent className="grid min-h-[320px] place-items-center p-6 text-center text-muted-foreground">
              <div>
                <RadioTower className="mx-auto mb-3 h-8 w-8 opacity-40" />
                <p className="text-sm">Select a machine to run jobs and view history.</p>
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
    <div className="flex items-baseline gap-2 rounded-lg border border-border bg-card px-3.5 py-2">
      <span className={cn("text-base font-semibold tabular-nums", live && value > 0 && "text-emerald-400")}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
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
        "flex w-full flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-3.5 text-left transition-colors hover:border-border/80 hover:bg-accent",
        selected && "border-primary bg-primary/10 hover:bg-primary/10",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            m.status === "online"
              ? "bg-emerald-400 shadow-[0_0_0_3px] shadow-emerald-400/20"
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
    <Card>
      <CardHeader>
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
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{machine?.name ?? "Machine"}</CardTitle>
              <button
                title="Rename"
                className="text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  setDraft(machine?.name ?? "");
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="mt-0.5 flex items-center gap-2">
            <code className="font-mono text-[11px] text-muted-foreground">{machineId}</code>
            {machine?.agentVersion && (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                agent {machine.agentVersion}
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            if (confirm("Revoke this device? It won't be able to reconnect.")) revoke.mutate();
          }}
        >
          <Trash2 /> Revoke
        </Button>
      </CardHeader>
      <CardContent>
        {machine?.deploy && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs">
            <span className="font-medium text-foreground/80">deploy</span>
            <Badge variant="outline">{machine.deploy.mode ?? "pm2"}</Badge>
            {machine.deploy.mode === "hook" ? (
              <code className="font-mono text-primary">{machine.deploy.hookPath}</code>
            ) : machine.deploy.repoUrl ? (
              <code className="font-mono text-primary">{machine.deploy.repoUrl}</code>
            ) : (
              <span className="text-amber-400">no git repo at {machine.deploy.appDir}</span>
            )}
            <span className="text-muted-foreground/70">
              {" · "}
              {machine.deploy.appDir}
              {machine.deploy.mode !== "hook" && ` · pm2 ${machine.deploy.pm2Target}`}
            </span>
          </div>
        )}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="sm:w-[150px]">
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
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="branch" />
          )}
          {action === "restart" && (
            <Input value={app} onChange={(e) => setApp(e.target.value)} placeholder="app (optional)" />
          )}
          <Button onClick={() => enqueue.mutate()} disabled={enqueue.isPending} className="sm:ml-auto">
            {enqueue.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            Enqueue
          </Button>
        </div>
        {enqueue.isError && <p className="mt-2 text-sm text-red-400">{(enqueue.error as Error).message}</p>}
        {lastJob && !enqueue.isError && (
          <p className="mt-2 flex items-center gap-2 text-sm text-emerald-400">
            <Check className="h-4 w-4" /> queued{" "}
            <Link to="/jobs/$jobId" params={{ jobId: lastJob }} className="font-mono underline-offset-2 hover:underline">
              {lastJob}
            </Link>
          </p>
        )}

        {machine && machine.hooks.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
              Custom commands
            </p>
            <div className="flex flex-wrap gap-2">
              {machine.hooks.map((h) => (
                <Button
                  key={h}
                  variant="outline"
                  size="sm"
                  onClick={() => runHookMut.mutate(h)}
                  disabled={runHookMut.isPending}
                >
                  <Terminal /> {h}
                </Button>
              ))}
            </div>
          </div>
        )}

        <p className="mb-1 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
          Recent jobs
        </p>
        <div className="divide-y divide-border/60">
          {jobs.data?.map((j) => (
            <div
              key={j.id}
              className="grid grid-cols-[100px_1fr_auto_auto] items-center gap-3 py-2.5"
            >
              <Badge variant={statusVariant(j.status)}>{j.status}</Badge>
              <span className="font-medium">{j.action}</span>
              <span className="text-xs text-muted-foreground/70">{timeAgo(j.createdAt)}</span>
              <Button asChild variant="outline" size="sm">
                <Link to="/jobs/$jobId" params={{ jobId: j.id }}>
                  <ScrollText /> Logs
                </Link>
              </Button>
            </div>
          ))}
          {jobs.data?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No jobs yet.</p>
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
          <DialogTitle>Enroll a machine</DialogTitle>
          <DialogDescription>
            {result
              ? "Run this on the new server. The token is one-time and shown once."
              : "Mint a one-time enroll token (valid 60 minutes)."}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />}
              Mint token
            </Button>
          </div>
        ) : (
          <>
            <pre className="overflow-x-auto rounded-lg border border-border bg-black/40 p-3.5 font-mono text-xs leading-relaxed text-muted-foreground">
              {installCmd}
            </pre>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(installCmd);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy command"}
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </div>
          </>
        )}
        {create.isError && <p className="text-sm text-red-400">{(create.error as Error).message}</p>}
      </DialogContent>
    </Dialog>
  );
}
