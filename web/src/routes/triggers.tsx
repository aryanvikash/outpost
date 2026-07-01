import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  X,
  Loader2,
  Webhook,
  Zap,
  KeyRound,
  ArrowRight,
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

interface TargetDraft {
  machineId: string;
  action: string;
  branch: string;
  app: string;
}

const emptyTarget = (): TargetDraft => ({ machineId: "", action: "deploy", branch: "main", app: "" });

export function TriggersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Triggers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One secret URL that fires one or more actions across your machines from
          any workflow — CI, cron, a custom system. Curl it, every target runs.
          Fires show up in the Webhook log as{" "}
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
  const [label, setLabel] = useState("");
  const [targets, setTargets] = useState<TargetDraft[]>([emptyTarget()]);
  const [created, setCreated] = useState<{ url: string } | null>(null);

  const machineList: Machine[] = (machines.data ?? []).filter((m) => !m.revoked);

  const patch = (i: number, p: Partial<TargetDraft>) =>
    setTargets((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...p } : t)));
  const addTarget = () => setTargets((ts) => [...ts, emptyTarget()]);
  const removeTarget = (i: number) => setTargets((ts) => ts.filter((_, idx) => idx !== i));

  const create = useMutation({
    mutationFn: () =>
      createTrigger({
        label: label || undefined,
        targets: targets
          .filter((t) => t.machineId && t.action)
          .map((t) => ({
            machineId: t.machineId,
            action: t.action,
            params:
              t.action === "deploy"
                ? { branch: t.branch }
                : t.action === "restart" && t.app
                  ? { app: t.app }
                  : {},
          })),
      }),
    onSuccess: (r) => {
      setCreated({ url: r.url });
      setLabel("");
      setTargets([emptyTarget()]);
      qc.invalidateQueries({ queryKey: ["triggers"] });
    },
  });

  const valid = targets.some((t) => t.machineId && t.action);

  return (
    <Card className={CARD}>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Zap className="h-5 w-5 text-primary" /> New trigger
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="label (e.g. ship-production) — optional"
          className="max-w-sm"
        />

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
            Targets — each runs when the URL is hit
          </p>
          {targets.map((t, i) => (
            <div
              key={i}
              className="grid gap-2.5 rounded-xl border border-white/5 bg-secondary/10 p-2.5 sm:grid-cols-[1fr_150px_1fr_auto] sm:items-center"
            >
              <Select value={t.machineId} onValueChange={(v) => patch(i, { machineId: v })}>
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
              <Select value={t.action} onValueChange={(v) => patch(i, { action: v })}>
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
              {t.action === "deploy" ? (
                <Input value={t.branch} onChange={(e) => patch(i, { branch: e.target.value })} placeholder="branch" />
              ) : t.action === "restart" ? (
                <Input value={t.app} onChange={(e) => patch(i, { app: e.target.value })} placeholder="app (optional)" />
              ) : (
                <div />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                disabled={targets.length === 1}
                onClick={() => removeTarget(i)}
              >
                <X />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addTarget}>
            <Plus /> Add target
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => create.mutate()} disabled={!valid || create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Zap />}
            Create trigger
          </Button>
          {create.isError && <p className="text-sm text-red-400">{(create.error as Error).message}</p>}
        </div>

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
              Fire it from anywhere: <code className="font-mono">curl -X POST {created.url}</code>
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
  const machines = useQuery({ queryKey: ["machines"], queryFn: listMachines });
  const nameOf = (id: string) => machines.data?.find((m) => m.id === id)?.name ?? id;

  const del = useMutation({
    mutationFn: (id: string) => deleteTrigger(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["triggers"] }),
  });

  return (
    <Card className={CARD}>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Active triggers</CardTitle>
        <span className="text-xs text-muted-foreground/80">POST the URL → run every target</span>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {triggers.data?.map((t) => (
          <div
            key={t.id}
            className="flex items-start gap-4 rounded-xl border border-white/5 bg-secondary/10 p-3.5 shadow-sm"
          >
            <Webhook className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground/95">{t.label ?? t.id}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {t.targets.map((tg, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1.5 rounded-md border border-white/5 bg-card/40 px-2 py-0.5 text-xs"
                  >
                    <Badge variant="secondary" className="border-0 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
                      {tg.action}
                    </Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                    <span className="font-mono text-muted-foreground/90">{nameOf(tg.machineId)}</span>
                  </span>
                ))}
              </div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground/60">
              {t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : "never used"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
