import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Loader2,
  Webhook,
  Zap,
  KeyRound,
  Server,
} from "lucide-react";
import {
  listMachines,
  listTriggers,
  createTrigger,
  deleteTrigger,
  ACTIONS,
  type Machine,
} from "../api";
import { timeAgo } from "../util";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/webhooks";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const CARD = "border-white/5 bg-card/40 backdrop-blur-xl shadow-lg rounded-xl";

export function TriggersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Triggers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Secret URLs that fire an action on a machine from any workflow — CI,
          cron, or a custom system. Curl the URL, it runs the bound action. Like a
          deploy hook. Fires show up in the Webhook log as{" "}
          <code className="rounded bg-secondary/30 px-1 py-0.5 font-mono text-xs text-primary">
            custom
          </code>
          .
        </p>
      </div>
      <CreateTriggerCard />
      <TriggerListCard />
    </div>
  );
}

function CreateTriggerCard() {
  const qc = useQueryClient();
  const machines = useQuery({ queryKey: ["machines"], queryFn: listMachines });
  const [machineId, setMachineId] = useState("");
  const [action, setAction] = useState("deploy");
  const [branch, setBranch] = useState("main");
  const [app, setApp] = useState("");
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<{ url: string } | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> =
        action === "deploy" ? { branch } : action === "restart" && app ? { app } : {};
      return createTrigger({ machineId, action, params, label: label || undefined });
    },
    onSuccess: (r) => {
      setCreated({ url: r.url });
      setLabel("");
      qc.invalidateQueries({ queryKey: ["triggers"] });
    },
  });

  const machineList: Machine[] = (machines.data ?? []).filter((m) => !m.revoked);
  const valid = machineId && action;

  return (
    <Card className={CARD}>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Zap className="h-5 w-5 text-primary" /> New trigger
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2.5 sm:grid-cols-[1fr_150px_1fr_150px_auto] sm:items-center">
          <Select value={machineId} onValueChange={setMachineId}>
            <SelectTrigger>
              <SelectValue placeholder="machine" />
            </SelectTrigger>
            <SelectContent>
              {machineList.map((m) => (
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
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {action === "deploy" ? (
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="branch" />
          ) : action === "restart" ? (
            <Input value={app} onChange={(e) => setApp(e.target.value)} placeholder="app (optional)" />
          ) : (
            <div />
          )}
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label (optional)" />
          <Button onClick={() => create.mutate()} disabled={!valid || create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Create
          </Button>
        </div>
        {create.isError && <p className="text-sm text-red-400">{(create.error as Error).message}</p>}

        {created && (
          <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <KeyRound className="h-4 w-4" /> Trigger URL — copy it now, it won't be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border border-white/5 bg-black/40 px-3 py-2 font-mono text-xs text-primary">
                {created.url}
              </code>
              <CopyButton value={created.url} />
            </div>
            <p className="text-xs text-muted-foreground">
              Fire it from anywhere:{" "}
              <code className="font-mono">curl -X POST {created.url}</code>
            </p>
            <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TriggerListCard() {
  const qc = useQueryClient();
  const triggers = useQuery({ queryKey: ["triggers"], queryFn: listTriggers });
  const del = useMutation({
    mutationFn: (id: string) => deleteTrigger(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["triggers"] }),
  });

  return (
    <Card className={CARD}>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Active triggers</CardTitle>
        <span className="text-xs text-muted-foreground/80">POST the URL → run action</span>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {triggers.data?.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-4 rounded-xl border border-white/5 bg-secondary/10 p-3.5 shadow-sm"
          >
            <Webhook className="h-4 w-4 shrink-0 text-primary" />
            <span className="font-medium text-foreground/95">{t.label ?? t.id}</span>
            <Badge variant="secondary" className="border-0 bg-primary/10 text-primary">
              {t.action}
            </Badge>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
              <Server className="h-3.5 w-3.5" />
              <code className="font-mono">{t.machineId}</code>
            </span>
            <span className="ml-auto text-xs text-muted-foreground/60">
              {t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : "never used"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => del.mutate(t.id)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {triggers.data?.length === 0 && (
          <div className="grid place-items-center gap-3 py-12 text-center text-muted-foreground">
            <Webhook className="h-8 w-8 text-primary opacity-40" />
            <p className="text-sm">No triggers yet — create one above.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
