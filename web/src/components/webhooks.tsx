// Shared, provider-neutral webhook UI: copy button, repository bindings, and the
// recent-deliveries feed. Used by both the GitHub and Bitbucket pages — bindings
// and deliveries are not provider-specific (one binding is matched by whichever
// provider's push arrives; the feed lists all deliveries).

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
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
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
    <Card>
      <CardHeader>
        <CardTitle>Recent deliveries</CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> auto-refresh
        </span>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border/60">
          {deliveries.data?.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2.5">
              <Badge variant="outline" className="font-mono">
                {d.event}
              </Badge>
              <span className="font-mono text-sm">{d.repo ?? "—"}</span>
              {d.branch && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  {d.branch}
                </span>
              )}
              {d.sha && (
                <code className="font-mono text-[11px] text-muted-foreground/70">
                  {d.sha.slice(0, 7)}
                </code>
              )}
              <Badge variant={resultVariant(d.result)} className="ml-1">
                {d.result ?? "—"}
              </Badge>
              {d.jobIds.length > 0 && (
                <Link
                  to="/jobs/$jobId"
                  params={{ jobId: d.jobIds[0] }}
                  className="font-mono text-[11px] text-primary underline-offset-2 hover:underline"
                >
                  {d.jobIds[0]}
                </Link>
              )}
              <span className="ml-auto text-xs text-muted-foreground/70">{timeAgo(d.ts)}</span>
            </div>
          ))}
          {deliveries.data?.length === 0 && (
            <div className="grid place-items-center gap-2 py-10 text-center text-muted-foreground">
              <Inbox className="h-7 w-7 opacity-50" />
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
    <Card>
      <CardHeader>
        <CardTitle>Repository bindings</CardTitle>
        <span className="text-xs text-muted-foreground">push to repo+branch → run action</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <AddBindingForm machines={machines.data ?? []} />

        <div className="divide-y divide-border/60">
          {bindings.data?.map((b) => (
            <div key={b.id} className="flex items-center gap-3 py-2.5">
              <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-mono text-sm">{b.repo}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <GitBranch className="h-3.5 w-3.5" />
                {b.branch}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              <Badge variant="secondary">{b.action}</Badge>
              <code className="font-mono text-[11px] text-muted-foreground">{b.machineId}</code>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-8 w-8 text-muted-foreground hover:text-red-400"
                onClick={() => del.mutate(b.id)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {bindings.data?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No bindings yet — add one above.
            </p>
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
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="grid gap-2.5 sm:grid-cols-[1fr_140px_1fr_120px_auto] sm:items-center">
        <Input placeholder="workspace/repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
        <Input placeholder="branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
        <Select value={machineId} onValueChange={setMachineId}>
          <SelectTrigger>
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
          <SelectTrigger>
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
        <Button onClick={() => create.mutate()} disabled={!valid || create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          Add
        </Button>
      </div>
      {create.isError && <p className="mt-2 text-sm text-red-400">{(create.error as Error).message}</p>}
    </div>
  );
}
