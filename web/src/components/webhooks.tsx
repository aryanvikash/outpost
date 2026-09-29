// Shared webhook UI: copy button, repository bindings, and the deliveries feed.
// BindingsCard lives on the Connections page (bindings are provider-neutral — one
// binding is matched by whichever provider's push arrives). DeliveriesCard is the
// Webhook log page: a single global feed, each row badged with its provider.

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Check,
  Trash2,
  Plus,
  GitBranch,
  Loader2,
  ArrowRight,
  Inbox,
  FolderGit2,
  Github,
  Webhook,
  RefreshCw,
} from "lucide-react";
import {
  listBindings,
  createBinding,
  deleteBinding,
  listMachines,
  listDeliveries,
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

const BIND_ACTIONS = ["deploy", "restart"];

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="icon"
      className="bg-card border-border hover:bg-primary/15 hover:text-primary transition-all h-9 w-9 shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function ProviderPill({
  provider,
}: {
  provider: "github" | "bitbucket" | "custom" | null;
}) {
  const base = "flex w-[74px] shrink-0 items-center gap-1.5 text-xs text-muted-foreground";
  if (provider === "github")
    return (
      <span className={base}>
        <Github className="h-3.5 w-3.5" /> GitHub
      </span>
    );
  if (provider === "bitbucket")
    return (
      <span className={base}>
        <FolderGit2 className="h-3.5 w-3.5" /> Bitbkt
      </span>
    );
  if (provider === "custom")
    return (
      <span className={base}>
        <Webhook className="h-3.5 w-3.5 text-primary" /> Custom
      </span>
    );
  return <span className="w-[74px] shrink-0 text-xs text-muted-foreground/50">—</span>;
}

export function DeliveriesCard() {
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const deliveries = useQuery({
    queryKey: ["deliveries"],
    queryFn: listDeliveries,
    refetchInterval: 10000,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (deliveries.data ?? []).filter((d) => {
      if (providerFilter !== "all" && (d.provider ?? "none") !== providerFilter) return false;
      if (q && !`${d.repo ?? ""} ${d.branch ?? ""} ${d.result ?? ""} ${d.event}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [deliveries.data, query, providerFilter]);

  function resultVariant(r: string | null): "success" | "danger" | "secondary" {
    if (!r) return "secondary";
    if (r.startsWith("enqueued")) return "success";
    if (r === "invalid signature" || r === "webhooks not configured") return "danger";
    return "secondary";
  }

  return (
    <Card className="border-border bg-card rounded-lg">
      <CardHeader className="flex flex-row items-center justify-between pb-4 space-y-0">
        <CardTitle className="text-lg">Recent deliveries</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={() => deliveries.refetch()} disabled={deliveries.isFetching} title="Refresh deliveries">
            <RefreshCw className={`h-3.5 w-3.5 ${deliveries.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> auto-refresh
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search repo, branch, result…"
            className="h-8 sm:max-w-xs"
            aria-label="Search deliveries"
          />
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="h-8 w-[150px]" aria-label="Filter by provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all providers</SelectItem>
              <SelectItem value="github">github</SelectItem>
              <SelectItem value="bitbucket">bitbucket</SelectItem>
              <SelectItem value="custom">custom</SelectItem>
              <SelectItem value="none">unknown</SelectItem>
            </SelectContent>
          </Select>
          {(query || providerFilter !== "all") && (
            <span className="text-xs text-muted-foreground">
              {filtered.length}/{deliveries.data?.length ?? 0}
            </span>
          )}
        </div>
        {deliveries.isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </p>
        )}
        {deliveries.isError && (
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-4 text-sm">
            <span className="text-destructive">{(deliveries.error as Error).message}</span>
            <Button variant="outline" size="sm" onClick={() => deliveries.refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        )}
        <div className="space-y-2.5">
          {filtered.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-background p-3.5 hover:bg-secondary transition-all shadow-sm">
              <ProviderPill provider={d.provider} />
              <Badge variant="outline" className="font-mono bg-card border-border text-xs">
                {d.event}
              </Badge>
              <span className="font-mono text-sm font-medium text-foreground/95 truncate max-w-full sm:max-w-[200px]">{d.repo ?? "—"}</span>
              {d.branch && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground/80 bg-secondary px-2 py-0.5 rounded-md border border-border">
                  <GitBranch className="h-3 w-3 text-primary" />
                  <span className="max-w-[160px] truncate">{d.branch}</span>
                </span>
              )}
              {d.sha && (
                <code className="font-mono text-[11px] text-muted-foreground/70 bg-card px-1.5 py-0.5 rounded border border-border">
                  {d.sha.slice(0, 7)}
                </code>
              )}
              <Badge variant={resultVariant(d.result)} className={cn("ml-1 justify-center", d.result?.startsWith("enqueued") && "bg-primary/15 text-primary border-0")}>
                {d.result ?? "—"}
              </Badge>
              {d.jobIds.length > 0 && (
                <span className="flex flex-wrap items-center gap-1.5">
                  {d.jobIds.map((jid) => (
                    <Link
                      key={jid}
                      to="/jobs/$jobId"
                      params={{ jobId: jid }}
                      className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                    >
                      {jid.slice(0, 12)}…
                    </Link>
                  ))}
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground/60 font-medium">{timeAgo(d.ts)}</span>
            </div>
          ))}
          {deliveries.isSuccess && filtered.length === 0 && deliveries.data?.length !== 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No deliveries match — clear search/filter.</p>
          )}
          {deliveries.data?.length === 0 && (
            <div className="grid place-items-center gap-3 py-12 text-center text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-40 text-primary" />
              <p className="text-sm">No deliveries yet — push to a bound repo.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function BindingsCard() {
  const qc = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const bindings = useQuery({ queryKey: ["bindings"], queryFn: listBindings, refetchInterval: 10000 });
  const machines = useQuery({ queryKey: ["machines"], queryFn: listMachines, refetchInterval: 5000 });

  const del = useMutation({
    mutationFn: (id: string) => deleteBinding(id),
    onSuccess: () => {
      setConfirmId(null);
      qc.invalidateQueries({ queryKey: ["bindings"] });
    },
  });

  return (
    <Card className="border-border bg-card rounded-lg">
      <CardHeader className="flex flex-row items-center justify-between pb-4 space-y-0">
        <div>
          <CardTitle className="text-lg">Repository bindings</CardTitle>
          <span className="text-xs text-muted-foreground/80">push to repo+branch → run action</span>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => { bindings.refetch(); machines.refetch(); }} title="Refresh bindings">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <AddBindingForm machines={(machines.data ?? []).filter((m) => !m.revoked)} />

        {bindings.isLoading && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </p>
        )}
        {bindings.isError && (
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-4 text-sm">
            <span className="text-destructive">{(bindings.error as Error).message}</span>
            <Button variant="outline" size="sm" onClick={() => bindings.refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        )}
        <div className="space-y-2.5">
          {bindings.data?.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-background p-3.5 hover:bg-secondary transition-all shadow-sm">
              <FolderGit2 className="h-4 w-4 shrink-0 text-primary" />
              <span className="font-mono text-sm font-semibold text-foreground/95 truncate max-w-full sm:max-w-[200px]">{b.repo}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground/80 bg-secondary px-2 py-0.5 rounded-md border border-border">
                <GitBranch className="h-3 w-3 text-primary" />
                {b.branch}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              <Badge variant="secondary" className="bg-primary/10 text-primary border-0">{b.action}</Badge>
              <code className="font-mono text-[11px] text-muted-foreground/80 bg-card px-2 py-0.5 rounded border border-border max-w-full truncate">{b.machineId}</code>
              {confirmId === b.id ? (
                <span className="ml-auto flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Delete?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7"
                    onClick={() => del.mutate(b.id)}
                    disabled={del.isPending}
                  >
                    {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm"}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => setConfirmId(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmId(b.id)}
                  title="Delete binding"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {bindings.data?.length === 0 && (
            <div className="rounded-lg border border-border bg-background py-8 text-center text-sm text-muted-foreground">
              No bindings yet — add one above.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AddBindingForm({ machines }: { machines: Machine[] }) {
  const qc = useQueryClient();
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [machineId, setMachineId] = useState("");
  const [action, setAction] = useState("deploy");

  const create = useMutation({
    mutationFn: () => createBinding({ repo, branch, machineId, action }),
    onSuccess: () => {
      setRepo("");
      qc.invalidateQueries({ queryKey: ["bindings"] });
    },
  });

  const valid = repo.includes("/") && branch && machineId;

  return (
    <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_1fr_120px_auto] sm:items-center">
        <Input placeholder="workspace/repo" value={repo} onChange={(e) => setRepo(e.target.value)} className="bg-card border-border" />
        <Input placeholder="branch" value={branch} onChange={(e) => setBranch(e.target.value)} className="bg-card border-border" />
        <Select value={machineId} onValueChange={setMachineId}>
          <SelectTrigger className="bg-card border-border">
            <SelectValue placeholder="machine" />
          </SelectTrigger>
          <SelectContent>
            {machines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="bg-card border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BIND_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => create.mutate()} disabled={!valid || create.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground transition-all">
          {create.isPending ? <Loader2 className="animate-spin h-4 w-4" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>
      {create.isError && <p className="mt-2 text-sm text-destructive font-semibold">{(create.error as Error).message}</p>}
    </div>
  );
}
