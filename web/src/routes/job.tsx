import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, Download, Loader2, RotateCcw, Square } from "lucide-react";
import { getJob, getJobLogs, cancelJob, enqueueJob, apiBase, getToken } from "../api";
import { formatDuration } from "../util";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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

const TERMINAL = new Set([
  "succeeded",
  "failed",
  "timed_out",
  "canceled",
  "interrupted",
  "superseded",
  "expired",
]);

function statusVariant(s: string): "success" | "danger" | "default" {
  if (s === "succeeded") return "success";
  if (["failed", "timed_out", "interrupted", "canceled"].includes(s)) return "danger";
  return "default";
}

interface LogChunk {
  seq: number;
  stream: string;
  chunk: string;
  ts?: number | null;
}

function formatTs(ts?: number | null): string | null {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Live-tail a job's logs over a WebSocket, falling back to REST polling if the
 * socket can't connect. Dedupes by stream:seq so backlog + live never double up.
 * Preserves server timestamps when present (REST backlog has them; live WS
 * frames currently don't, so ts stays undefined until a re-poll fills it in).
 */
function useLiveLogs(jobId: string) {
  const [lines, setLines] = useState<LogChunk[]>([]);
  const [live, setLive] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    seen.current = new Set();
    setLines([]);
    setLive(false);

    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const add = (items: { seq: number; stream: string; chunk: string; ts?: number | null }[]) => {
      setLines((prev) => {
        const next = prev.slice();
        for (const it of items) {
          const key = `${it.stream}:${it.seq}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          next.push({ seq: it.seq, stream: it.stream, chunk: it.chunk, ts: it.ts ?? null });
        }
        // WS live frames and REST backlog can arrive out of order; keep the
        // stream:seq ordering stable so timestamps read top-to-bottom.
        next.sort((a, b) => {
          if (a.stream !== b.stream) return a.stream < b.stream ? -1 : 1;
          return a.seq - b.seq;
        });
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
  const qc = useQueryClient();
  const [actionBusy, setActionBusy] = useState<"cancel" | "retry" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleCancel = async () => {
    setActionBusy("cancel");
    setActionError(null);
    try {
      await cancelJob(jobId);
      await job.refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleRetry = async () => {
    if (!job.data) return;
    setActionBusy("retry");
    setActionError(null);
    try {
      const full = await getJob(jobId);
      await enqueueJob(full.machineId, full.action, (full.params as Record<string, unknown>) ?? {});
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      await job.refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const [query, setQuery] = useState("");
  const [streamFilter, setStreamFilter] = useState<"all" | "stdout" | "stderr">("all");
  const [showTs, setShowTs] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => {
      if (streamFilter !== "all" && l.stream !== streamFilter) return false;
      if (q && !l.chunk.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lines, query, streamFilter]);

  const isFiltering = query.trim() !== "" || streamFilter !== "all";

  // Auto-scroll to bottom on new output while follow mode is on.
  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length, follow]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    // Scrolling up pauses follow; scrolling back to bottom resumes it.
    setFollow((prev) => (prev === nearBottom ? prev : nearBottom));
  };

  const visibleText = useMemo(
    () =>
      filtered
        .map((l) => {
          const ts = showTs ? formatTs(l.ts) : null;
          return ts ? `[${ts}] ${l.chunk}` : l.chunk;
        })
        .join(""),
    [filtered, showTs],
  );

  const handleCopy = async () => {
    if (!visibleText) return;
    try {
      await navigator.clipboard.writeText(visibleText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleDownload = () => {
    if (!visibleText) return;
    const blob = new Blob([visibleText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-${jobId}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="text-base">Job</CardTitle>
            <code className="font-mono text-[11px] text-muted-foreground">{jobId}</code>
          </div>
          <div className="flex items-center gap-2">
            {running && (
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={actionBusy !== null} title="Request cancellation">
                {actionBusy === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                Cancel
              </Button>
            )}
            {!running && job.data && (
              <Button variant="outline" size="sm" onClick={handleRetry} disabled={actionBusy !== null} title="Re-run with same action + params">
                {actionBusy === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Re-run
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              {job.data ? (
                <Link to="/machines/$machineId" params={{ machineId: job.data.machineId }}>
                  <ArrowLeft /> Machine
                </Link>
              ) : (
                <Link to="/">
                  <ArrowLeft /> Back
                </Link>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {job.isError && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-red-400">{(job.error as Error).message}</p>
              <Button variant="outline" size="sm" onClick={() => job.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {actionError && <p className="mt-2 text-sm text-red-400">{actionError}</p>}
          {job.data && (
            <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Field label="Status">
                <Badge variant={statusVariant(job.data.status)}>{job.data.status}</Badge>
              </Field>
              <Field label="Action">{job.data.action}</Field>
              <Field label="Exit code">{job.data.exitCode ?? "—"}</Field>
              <Field label="Duration">{formatDuration(job.data.createdAt, job.data.finishedAt)}</Field>
              <Field label="Machine">
                <Link
                  to="/machines/$machineId"
                  params={{ machineId: job.data.machineId }}
                  className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                >
                  {job.data.machineId}
                </Link>
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
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {filtered.length}/{lines.length} chunks
              {isFiltering && filtered.length !== lines.length ? " (filtered)" : ""}
            </span>
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
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search logs…"
              className="h-8 sm:max-w-xs"
              aria-label="Search logs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Select value={streamFilter} onValueChange={(v) => setStreamFilter(v as typeof streamFilter)}>
                <SelectTrigger className="h-8 w-[130px]" aria-label="Filter by stream">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">stdout+stderr</SelectItem>
                  <SelectItem value="stdout">stdout</SelectItem>
                  <SelectItem value="stderr">stderr</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant={showTs ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowTs((v) => !v)}
                aria-pressed={showTs}
                title="Show server timestamps (from REST backlog; live frames may not have one yet)"
              >
                Timestamps
              </Button>
              <Button
                variant={wrap ? "secondary" : "outline"}
                size="sm"
                onClick={() => setWrap((v) => !v)}
                aria-pressed={wrap}
                title="Toggle line wrapping"
              >
                Wrap
              </Button>
              <Button
                variant={follow ? "secondary" : "outline"}
                size="sm"
                onClick={() => setFollow((v) => !v)}
                aria-pressed={follow}
                title="Auto-scroll to newest output"
              >
                Follow
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopy} disabled={!visibleText} title="Copy visible logs">
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownload} disabled={!visibleText} title="Download visible logs as .log">
                <Download /> Download
              </Button>
            </div>
          </div>
          <pre
            ref={scrollRef}
            onScroll={handleScroll}
            className={`max-h-[460px] overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-[12.5px] leading-relaxed ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
          >
            {filtered.length > 0 ? (
              filtered.map((l, i) => (
                <span key={`${l.stream}:${l.seq}:${i}`} className={l.stream === "stderr" ? "text-red-400" : "text-foreground/90"}>
                  {showTs && (
                    <span className="mr-2 select-none text-muted-foreground/70">
                      [{formatTs(l.ts) ?? "--:--:--.---"}]
                    </span>
                  )}
                  {query.trim() ? <Highlighted chunk={l.chunk} query={query.trim()} /> : l.chunk}
                </span>
              ))
            ) : lines.length > 0 ? (
              <span className="text-muted-foreground">(no lines match — clear search/filter)</span>
            ) : (
              <span className="text-muted-foreground">(no output yet)</span>
            )}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function Highlighted({ chunk, query }: { chunk: string; query: string }) {
  if (query === "" || !chunk.toLowerCase().includes(query.toLowerCase())) return <>{chunk}</>;
  // Highlight all case-insensitive occurrences within this chunk.
  const parts: ReactNode[] = [];
  let rest = chunk;
  let restLower = chunk.toLowerCase();
  const qLower = query.toLowerCase();
  let k = 0;
  while (rest) {
    const i = restLower.indexOf(qLower);
    if (i === -1) {
      parts.push(<span key={k++}>{rest}</span>);
      break;
    }
    if (i > 0) parts.push(<span key={k++}>{rest.slice(0, i)}</span>);
    parts.push(
      <mark key={k++} className="rounded-sm bg-yellow-400/40 text-inherit">
        {rest.slice(i, i + query.length)}
      </mark>,
    );
    rest = rest.slice(i + query.length);
    restLower = restLower.slice(i + query.length);
  }
  return <>{parts}</>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground/70">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  );
}
