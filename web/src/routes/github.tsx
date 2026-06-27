import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Check,
  Github,
  Trash2,
  Plus,
  GitBranch,
  Loader2,
  ArrowRight,
  Inbox,
} from "lucide-react";
import {
  listBindings,
  createBinding,
  deleteBinding,
  listMachines,
  listDeliveries,
  webhookUrl,
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

export function GitHubPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">GitHub</h1>
      <AppCard />
      <BindingsCard />
      <DeliveriesCard />
    </div>
  );
}

function DeliveriesCard() {
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

function CopyButton({ value }: { value: string }) {
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

function AppCard() {
  const hook = webhookUrl();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-4 w-4" /> GitHub App
        </CardTitle>
        <a
          href="https://github.com/settings/apps/new"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline-offset-2 hover:underline"
        >
          Create App ↗
        </a>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Install a GitHub App to auto-deploy on push — installed repos deliver{" "}
          <code className="font-mono text-xs">push</code> events here, no per-repo webhook needed.
        </p>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            Webhook URL
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-border bg-black/40 px-3 py-2 font-mono text-xs">
              {hook}
            </code>
            <CopyButton value={hook} />
          </div>
        </div>

        <ol className="space-y-1.5 text-sm text-muted-foreground">
          <li>
            <span className="text-foreground">1.</span> Set this as the App's webhook URL; subscribe to{" "}
            <b className="text-foreground">Push</b> events.
          </li>
          <li>
            <span className="text-foreground">2.</span> Permissions:{" "}
            <b className="text-foreground">Commit statuses → Read &amp; write</b> (for deploy feedback).
          </li>
          <li>
            <span className="text-foreground">3.</span> On the Worker, set secrets{" "}
            <code className="font-mono text-xs">GITHUB_WEBHOOK_SECRET</code>,{" "}
            <code className="font-mono text-xs">GITHUB_APP_ID</code>,{" "}
            <code className="font-mono text-xs">GITHUB_APP_PRIVATE_KEY</code>.
          </li>
          <li>
            <span className="text-foreground">4.</span> Add a repo binding below, then install the App on that repo.
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

function BindingsCard() {
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
              <Github className="h-4 w-4 shrink-0 text-muted-foreground" />
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
        <Input placeholder="owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
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
