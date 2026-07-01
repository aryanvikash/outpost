import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellRing,
  Loader2,
  Check,
  WifiOff,
  XCircle,
  Send,
  Inbox,
} from "lucide-react";
import {
  listAlerts,
  getAlertConfig,
  updateAlertConfig,
  listMachines,
  type Alert,
  type AlertConfig,
} from "../api";
import { timeAgo } from "../util";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const CARD = "border-white/5 bg-card/40 backdrop-blur-xl shadow-lg rounded-xl";

export function AlertsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Get notified when a machine goes offline or a job fails. Alerts show
          below and, if a destination is set, are POSTed to it (Slack / Discord /
          custom).
        </p>
      </div>
      <AlertConfigCard />
      <AlertFeedCard />
    </div>
  );
}

function AlertConfigCard() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["alertConfig"], queryFn: getAlertConfig });
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState({ machine_offline: true, job_failed: true });

  useEffect(() => {
    if (cfg.data) {
      setUrl(cfg.data.webhookUrl);
      setEvents(cfg.data.events);
    }
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: () => updateAlertConfig({ webhookUrl: url, events } as AlertConfig),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alertConfig"] }),
  });

  return (
    <Card className={CARD}>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BellRing className="h-5 w-5 text-primary" /> Destination
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
            Webhook URL
          </p>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/…  (leave empty to disable)"
            className="font-mono text-xs"
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
            Notify on
          </p>
          <div className="flex flex-wrap gap-2">
            <Toggle
              on={events.machine_offline}
              onClick={() => setEvents((e) => ({ ...e, machine_offline: !e.machine_offline }))}
              icon={<WifiOff className="h-3.5 w-3.5" />}
              label="Machine offline"
            />
            <Toggle
              on={events.job_failed}
              onClick={() => setEvents((e) => ({ ...e, job_failed: !e.job_failed }))}
              icon={<XCircle className="h-3.5 w-3.5" />}
              label="Job failed / interrupted"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            Save
          </Button>
          {save.isSuccess && <span className="text-xs text-emerald-400">Saved</span>}
          {save.isError && (
            <span className="text-xs text-red-400">{(save.error as Error).message}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Toggle({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all",
        on
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-white/5 bg-secondary/20 text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn("grid h-4 w-4 place-items-center rounded", on ? "bg-primary text-primary-foreground" : "bg-secondary")}>
        {on && <Check className="h-3 w-3" />}
      </span>
      {icon}
      {label}
    </button>
  );
}

function AlertFeedCard() {
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: listAlerts, refetchInterval: 10000 });
  const machines = useQuery({ queryKey: ["machines"], queryFn: listMachines });
  const nameOf = (id: string | null) =>
    machines.data?.find((m) => m.id === id)?.name ?? id ?? "—";

  return (
    <Card className={CARD}>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="h-5 w-5 text-primary" /> Recent alerts
        </CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_8px_1px] shadow-primary/50" />{" "}
          auto-refresh
        </span>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {alerts.data?.map((a) => (
          <AlertRow key={a.id} alert={a} machineName={nameOf(a.machineId)} />
        ))}
        {alerts.data?.length === 0 && (
          <div className="grid place-items-center gap-3 py-12 text-center text-muted-foreground">
            <Inbox className="h-8 w-8 text-primary opacity-40" />
            <p className="text-sm">No alerts — all quiet.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertRow({ alert, machineName }: { alert: Alert; machineName: string }) {
  const offline = alert.type === "machine_offline";
  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/5 bg-secondary/10 p-3.5 shadow-sm">
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
          offline ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400",
        )}
      >
        {offline ? <WifiOff className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground/95">
          {offline ? (
            <>
              <span className="font-semibold">{machineName}</span> went offline
            </>
          ) : (
            <>
              {alert.status ?? "failed"} — <span className="font-semibold">{machineName}</span>
            </>
          )}
        </p>
        {alert.detail && (
          <p className="truncate text-xs text-muted-foreground/70">{alert.detail}</p>
        )}
      </div>
      {alert.delivered && (
        <Badge variant="outline" className="ml-auto border-white/5 text-xs text-muted-foreground">
          <Send className="mr-1 h-3 w-3" /> sent
        </Badge>
      )}
      <span className={cn("text-xs text-muted-foreground/60", !alert.delivered && "ml-auto")}>
        {timeAgo(alert.ts)}
      </span>
    </div>
  );
}
