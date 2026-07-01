// Shared webhook UI: copy button, repository bindings, and the deliveries feed.
// BindingsCard lives on the Connections page (bindings are provider-neutral — one
// binding is matched by whichever provider's push arrives). DeliveriesCard is the
// Webhook log page: a single global feed, each row badged with its provider.

import { useState } from "react";
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
      className="bg-card/50 border-white/5 hover:bg-primary/15 hover:text-primary transition-all h-9 w-9 shrink-0"
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

function ProviderPill({ provider }: { provider: "github" | "bitbucket" | null }) {
  if (provider === "github")
    return (
      <span className="flex w-[74px] shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Github className="h-3.5 w-3.5" /> GitHub
      </span>
    );
  if (provider === "bitbucket")
    return (
      <span className="flex w-[74px] shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <FolderGit2 className="h-3.5 w-3.5" /> Bitbkt
      </span>
    );
  return <span className="w-[74px] shrink-0 text-xs text-muted-foreground/50">—</span>;
}

export function DeliveriesCard() {
  const deliveries = useQuery({
    queryKey: ["deliveries"],
    queryFn: listDeliveries,
    refetchInterval: 10000,
  });

  function resultVariant(r: string | null): "success" | "danger" | "secondary" {
    if (!r) return "secondary";
    if (r.startsWith("enqueued")) return "success";
    if (r === "invalid signature" || r === "webhooks not configured") return "danger";
    return "secondary";
  }

  return (
    <Card className="border-white/5 bg-card/40 backdrop-blur-xl shadow-lg rounded-xl">
      <CardHeader className="flex flex-row items-center justify-between pb-6 space-y-0">
        <CardTitle className="text-lg">Recent deliveries</CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_8px_1px] shadow-primary/50" /> auto-refresh
        </span>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5">
          {deliveries.data?.map((d) => (
            <div key={d.id} className="flex items-center gap-4 rounded-xl border border-white/5 bg-secondary/10 p-3.5 hover:bg-secondary/15 transition-all shadow-sm">
              <ProviderPill provider={d.provider} />
              <Badge variant="outline" className="font-mono bg-card/40 border-white/5 text-xs">
                {d.event}
              </Badge>
              <span className="font-mono text-sm font-medium text-foreground/95 truncate max-w-[200px]">{d.repo ?? "—"}</span>
              {d.branch && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground/80 bg-secondary/20 px-2 py-0.5 rounded-md border border-white/5">
                  <GitBranch className="h-3 w-3 text-primary" />
                  {d.branch}
                </span>
              )}
              {d.sha && (
                <code className="font-mono text-[11px] text-muted-foreground/70 bg-card/30 px-1.5 py-0.5 rounded border border-white/5">
                  {d.sha.slice(0, 7)}
                </code>
              )}
              <Badge variant={resultVariant(d.result)} className={cn("ml-1 justify-center", d.result?.startsWith("enqueued") && "bg-primary/15 text-primary border-0")}>
                {d.result ?? "—"}
              </Badge>
              {d.jobIds.length > 0 && (
                <Link
                  to="/jobs/$jobId"
                  params={{ jobId: d.jobIds[0] }}
                  className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                >
                  {d.jobIds[0]}
                </Link>
              )}
              <span className="ml-auto text-xs text-muted-foreground/60 font-medium">{timeAgo(d.ts)}</span>
            </div>
          ))}
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
  const bindings = useQuery({ queryKey: ["bindings"], queryFn: listBindings });
  const machines = useQuery({ queryKey: ["machines"], queryFn: listMachines });

  const del = useMutation({
    mutationFn: (id: string) => deleteBinding(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bindings"] }),
  });

  return (
    <Card className="border-white/5 bg-card/40 backdrop-blur-xl shadow-lg rounded-xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Repository bindings</CardTitle>
        <span className="text-xs text-muted-foreground/80">push to repo+branch → run action</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <AddBindingForm machines={machines.data ?? []} />
 
        <div className="space-y-2.5">
          {bindings.data?.map((b) => (
            <div key={b.id} className="flex items-center gap-4 rounded-xl border border-white/5 bg-secondary/10 p-3.5 hover:bg-secondary/15 transition-all shadow-sm">
              <FolderGit2 className="h-4 w-4 shrink-0 text-primary" />
              <span className="font-mono text-sm font-semibold text-foreground/95 truncate max-w-[200px]">{b.repo}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground/80 bg-secondary/20 px-2 py-0.5 rounded-md border border-white/5">
                <GitBranch className="h-3 w-3 text-primary" />
                {b.branch}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              <Badge variant="secondary" className="bg-primary/10 text-primary border-0">{b.action}</Badge>
              <code className="font-mono text-[11px] text-muted-foreground/80 bg-card/30 px-2 py-0.5 rounded border border-white/5">{b.machineId}</code>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => del.mutate(b.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {bindings.data?.length === 0 && (
            <div className="rounded-xl border border-white/5 bg-secondary/10 py-8 text-center text-sm text-muted-foreground">
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
    <div className="rounded-xl border border-white/5 bg-secondary/15 p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_1fr_120px_auto] sm:items-center">
        <Input placeholder="workspace/repo" value={repo} onChange={(e) => setRepo(e.target.value)} className="bg-card/50 border-white/10" />
        <Input placeholder="branch" value={branch} onChange={(e) => setBranch(e.target.value)} className="bg-card/50 border-white/10" />
        <Select value={machineId} onValueChange={setMachineId}>
          <SelectTrigger className="bg-card/50 border-white/10">
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
          <SelectTrigger className="bg-card/50 border-white/10">
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
        <Button onClick={() => create.mutate()} disabled={!valid || create.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_rgba(var(--primary),0.3)] transition-all">
          {create.isPending ? <Loader2 className="animate-spin h-4 w-4" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>
      {create.isError && <p className="mt-2 text-sm text-destructive font-semibold">{(create.error as Error).message}</p>}
    </div>
  );
}
