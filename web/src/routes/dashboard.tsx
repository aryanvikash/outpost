import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Copy, Check, Loader2, ChevronRight, Server } from "lucide-react";
import { listMachines, createEnrollToken, apiBase, type Machine } from "../api";
import { timeAgo } from "../util";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function DashboardPage() {
  const [enrollOpen, setEnrollOpen] = useState(false);

  const machines = useQuery({
    queryKey: ["machines"],
    queryFn: listMachines,
    refetchInterval: 5000,
  });

  const all = machines.data ?? [];
  const visible = all.filter((m) => !m.revoked);
  const revokedCount = all.length - visible.length;
  const online = visible.filter((m) => m.status === "online").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight">Machines</h1>
          <div className="flex gap-2.5">
            <Stat label="machines" value={visible.length} />
            <Stat label="online" value={online} live />
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setEnrollOpen(true)}
          className="border border-primary/20 bg-primary/10 text-primary transition-all hover:bg-primary/20"
        >
          <Plus className="mr-1 h-4 w-4" /> Add Machine
        </Button>
      </div>

      {machines.isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
        </p>
      )}
      {machines.isError && <p className="text-sm text-red-400">{(machines.error as Error).message}</p>}

      {!machines.isLoading && visible.length === 0 && (
        <Card className="border-border bg-card">
          <CardContent className="grid min-h-[280px] place-items-center py-12 text-center text-muted-foreground">
            <div className="flex flex-col items-center">
              <svg width="72" height="72" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-4 opacity-80">
                <rect x="8" y="8" width="48" height="48" rx="12" className="fill-primary/5 stroke-primary/30" strokeWidth="1.5" strokeDasharray="4 4" />
                <path d="M32 24V40 M24 32H40" className="stroke-primary/70" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <p className="text-sm font-medium">No machines connected yet.</p>
              <Button size="sm" className="mt-4 bg-primary/10 text-primary hover:bg-primary/20" onClick={() => setEnrollOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Add your first machine
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {visible.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((m) => (
            <MachineCard key={m.id} m={m} />
          ))}
        </div>
      )}

      {revokedCount > 0 && (
        <p className="text-center text-[11px] text-muted-foreground/50">{revokedCount} revoked hidden</p>
      )}

      <EnrollDialog open={enrollOpen} onOpenChange={setEnrollOpen} />
    </div>
  );
}

function Stat({ label, value, live }: { label: string; value: number; live?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 rounded-lg border border-border bg-card px-4 py-2 shadow-sm">
      <span className={cn("text-lg font-bold tabular-nums", live && value > 0 && "text-primary")}>{value}</span>
      <span className="text-xs font-medium text-muted-foreground/80">{label}</span>
    </div>
  );
}

function MachineCard({ m }: { m: Machine }) {
  const online = m.status === "online";
  return (
    <Link
      to="/machines/$machineId"
      params={{ machineId: m.id }}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors duration-150 hover:border-foreground/25"
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
            online ? "bg-emerald-500/15 text-emerald-400" : "bg-secondary text-muted-foreground",
          )}
        >
          <Server className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold">
            <span className="truncate">{m.name}</span>
          </p>
          <p className="flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                online ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            <span className={online ? "text-emerald-400" : "text-muted-foreground/70"}>
              {online ? "online" : "offline"}
            </span>
            <span className="text-muted-foreground/50">· {timeAgo(m.lastSeen)}</span>
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <code className="truncate rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {m.id}
        </code>
        <Badge variant="outline" className="ml-auto border-border px-1.5 py-0 text-[10px] text-muted-foreground">
          {m.agentVersion ?? "—"}
        </Badge>
        {m.deploy?.mode && (
          <Badge variant="secondary" className="border-0 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
            {m.deploy.mode}
          </Badge>
        )}
      </div>
    </Link>
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

  function copy() {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
              {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Generate token
            </Button>
          </div>
        ) : (
          <>
            <div className="group relative">
              <pre className="whitespace-pre-wrap break-all rounded-lg border border-border bg-secondary p-4 pr-12 font-mono text-xs leading-relaxed text-primary/95">
                {installCmd}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-3.5 top-3.5 h-8 w-8 text-muted-foreground opacity-70 transition-all hover:bg-secondary hover:text-primary group-hover:opacity-100"
                onClick={copy}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-2 flex justify-end gap-2.5">
              <Button variant="outline" className="border-border bg-secondary hover:border-primary/30 hover:bg-primary/10 hover:text-primary" onClick={copy}>
                {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                {copied ? "Copied" : "Copy command"}
              </Button>
              <Button onClick={() => close(false)} className="bg-primary font-semibold text-primary-foreground hover:bg-primary/95">
                Done
              </Button>
            </div>
          </>
        )}
        {create.isError && <p className="text-sm font-semibold text-destructive">{(create.error as Error).message}</p>}
      </DialogContent>
    </Dialog>
  );
}
