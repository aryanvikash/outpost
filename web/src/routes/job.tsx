import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { getJob, getJobLogs, apiBase, getToken } from "../api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const TERMINAL = new Set(["succeeded", "failed", "timed_out", "canceled", "interrupted"]);

function statusVariant(s: string): "success" | "danger" | "default" {
  if (s === "succeeded") return "success";
  if (["failed", "timed_out", "interrupted", "canceled"].includes(s)) return "danger";
  return "default";
}

interface LogLine {
  stream: string;
  chunk: string;
}

/**
 * Live-tail a job's logs over a WebSocket, falling back to REST polling if the
 * socket can't connect. Dedupes by stream:seq so backlog + live never double up.
 */
function useLiveLogs(jobId: string) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [live, setLive] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    seen.current = new Set();
    setLines([]);
    setLive(false);

    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const add = (items: { seq: number; stream: string; chunk: string }[]) => {
      setLines((prev) => {
        const next = prev.slice();
        for (const it of items) {
          const key = `${it.stream}:${it.seq}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          next.push({ stream: it.stream, chunk: it.chunk });
        }
        return next;
      });
    };

    const startPolling = () => {
      if (poll || disposed) return;
      const tick = async () => {
        try {
          add(await getJobLogs(jobId));
        } catch {
          /* ignore */
        }
      };
      void tick();
      poll = setInterval(tick, 2500);
    };

    const token = getToken() ?? "";
    const url = `${apiBase().replace(/^http/, "ws")}/api/jobs/${jobId}/tail?token=${encodeURIComponent(token)}`;

    try {
      ws = new WebSocket(url);
      ws.onopen = () => {
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
        setLive(true);
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data as string);
        if (m.type === "backlog") add(m.logs);
        else if (m.type === "log") add([m]);
        else if (m.type === "end") setLive(false);
      };
      ws.onclose = () => {
        if (disposed) return;
        setLive(false);
        startPolling(); // socket dropped → fall back
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      startPolling();
    }

    return () => {
      disposed = true;
      if (poll) clearInterval(poll);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [jobId]);

  return { lines, live };
}

export function JobPage() {
  const { jobId } = useParams({ from: "/jobs/$jobId" });

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    refetchInterval: (q) => (q.state.data && TERMINAL.has(q.state.data.status) ? false : 2000),
  });

  const { lines, live } = useLiveLogs(jobId);
  const running = job.data ? !TERMINAL.has(job.data.status) : true;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="text-base">Job</CardTitle>
            <code className="font-mono text-[11px] text-muted-foreground">{jobId}</code>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/" search={{ machine: job.data?.machineId }}>
              <ArrowLeft /> Back
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {job.isError && <p className="text-sm text-red-400">{(job.error as Error).message}</p>}
          {job.data && (
            <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Field label="Status">
                <Badge variant={statusVariant(job.data.status)}>{job.data.status}</Badge>
              </Field>
              <Field label="Action">{job.data.action}</Field>
              <Field label="Exit code">{job.data.exitCode ?? "—"}</Field>
              <Field label="Machine">
                <code className="font-mono text-xs text-muted-foreground">{job.data.machineId}</code>
              </Field>
              {job.data.error && (
                <div className="col-span-2 sm:col-span-4">
                  <Field label="Error">
                    <span className="text-red-400">{job.data.error}</span>
                  </Field>
                </div>
              )}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
          {live ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> live tailing
            </span>
          ) : (
            running && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" /> polling
              </span>
            )
          )}
        </CardHeader>
        <CardContent>
          <pre className="max-h-[460px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-black/40 p-4 font-mono text-[12.5px] leading-relaxed">
            {lines.length > 0 ? (
              lines.map((l, i) => (
                <span key={i} className={l.stream === "stderr" ? "text-red-400" : "text-foreground/90"}>
                  {l.chunk}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">(no output yet)</span>
            )}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground/70">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  );
}
