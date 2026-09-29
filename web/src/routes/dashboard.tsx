import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Copy, Check, Loader2, ChevronRight, Server, RefreshCw, Search } from "lucide-react";
import { listMachines, createEnrollToken, apiBase, type Machine } from "../api";
import { timeAgo } from "../util";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function DashboardPage() {
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [showRevoked, setShowRevoked] = useState(false);

  const machines = useQuery({
    queryKey: ["machines"],
    queryFn: listMachines,
    refetchInterval: 5000,
  });

  const all = machines.data ?? [];
  const revokedCount = all.filter((m) => m.revoked).length;
  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((m) => {
      if (!showRevoked && m.revoked) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (q && !`${m.name} ${m.id}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, query, statusFilter, showRevoked]);
  const visible = base;
  const online = all.filter((m) => !m.revoked && m.status === "online").length;
  const totalNonRevoked = all.filter((m) => !m.revoked).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight">Machines</h1>
          <div className="flex gap-2.5">
            <Stat label="machines" value={totalNonRevoked} />
            <Stat label="online" value={online} live />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => machines.refetch()} disabled={machines.isFetching} title="Refresh machines">
            <RefreshCw className={`h-3.5 w-3.5 ${machines.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setEnrollOpen(true)}
            className="border border-primary/20 bg-primary/10 text-primary transition-all hover:bg-primary/20"
          >
            <Plus className="mr-1 h-4 w-4" /> Add Machine
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or id…"
            className="h-8 pl-8"
            aria-label="Search machines"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="h-8 w-[130px]" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all statuses</SelectItem>
              <SelectItem value="online">online</SelectItem>
              <SelectItem value="offline">offline</SelectItem>
            </SelectContent>
          </Select>
          {revokedCount > 0 && (
            <Button
              variant={showRevoked ? "secondary" : "outline"}
              size="sm"
              className="h-8"
              onClick={() => setShowRevoked((v) => !v)}
              aria-pressed={showRevoked}
            >
              Revoked ({revokedCount})
            </Button>
          )}
          {(query || statusFilter !== "all") && (
            <span className="text-xs text-muted-foreground">
              {visible.length}/{totalNonRevoked}
            </span>
          )}
        </div>
      </div>

      {machines.isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
        </p>
      )}
      {machines.isError && (
        <div className="flex items-center justify-between rounded-lg border border-border px-4 py-4 text-sm">
          <span className="text-destructive">{(machines.error as Error).message}</span>
          <Button variant="outline" size="sm" onClick={() => machines.refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      )}

      {!machines.isLoading && !machines.isError && visible.length === 0 && (
        <Card className="border-border bg-card">
          <CardContent className="grid min-h-[280px] place-items-center py-12 text-center text-muted-foreground">
            {all.length === 0 ? (
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
            ) : (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm font-medium">No machines match — clear search/filter.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setStatusFilter("all");
                    setShowRevoked(false);
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
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

      {!showRevoked && revokedCount > 0 && (
        <p className="text-center text-[11px] text-muted-foreground/50">
          <button className="underline-offset-4 hover:underline" onClick={() => setShowRevoked(true)}>
            {revokedCount} revoked hidden — show
          </button>
        </p>
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
      className={`group flex flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors duration-150 hover:border-foreground/25 ${m.revoked ? "opacity-60" : ""}`}
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
        {m.revoked && (
          <Badge variant="danger" className="px-1.5 py-0 text-[10px]">
            revoked
          </Badge>
        )}
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
  const [result, setResult] = useState<{ token: string; uses: number; expiresAt: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [label, setLabel] = useState("");
  const [uses, setUses] = useState("1");
  const [expires, setExpires] = useState("60");

  const create = useMutation({
    mutationFn: () => {
      const parsedUses = Math.min(Math.max(parseInt(uses, 10) || 1, 1), 10000);
      const parsedExp = Math.min(Math.max(parseInt(expires, 10) || 60, 1), 60 * 24 * 30);
      return createEnrollToken({
        label: label.trim() || undefined,
        uses: parsedUses,
        expiresInMinutes: parsedExp,
      });
    },
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
      setLabel("");
      setUses("1");
      setExpires("60");
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
              ? `Run this on the new server. Token allows ${result.uses} use${result.uses === 1 ? "" : "s"}, expires ${new Date(result.expiresAt).toLocaleString()} — shown once.`
              : "Generate a connect token. Use 1 use / 60 min for one server, or more uses for a fleet."}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_110px_130px]">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label (optional)" aria-label="Token label" />
              <Input
                value={uses}
                onChange={(e) => setUses(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="uses"
                inputMode="numeric"
                aria-label="Number of uses"
                title="How many machines can enroll with this token (1-10000)"
              />
              <Select value={expires} onValueChange={setExpires}>
                <SelectTrigger aria-label="Token expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="60">expires 1h</SelectItem>
                  <SelectItem value="1440">expires 24h</SelectItem>
                  <SelectItem value="10080">expires 7d</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Generate token
              </Button>
            </div>
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
