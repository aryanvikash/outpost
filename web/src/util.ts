export function timeAgo(ms: number | null | undefined): string {
  if (!ms) return "never";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function formatDuration(createdAt: number | null | undefined, finishedAt: number | null | undefined): string {
  if (!createdAt) return "—";
  const end = finishedAt ?? Date.now();
  const ms = Math.max(0, end - createdAt);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Colour for a usage %: red at the API's 90% machine_resource alert, amber from 75%. */
export function usageTone(pct: number): string {
  if (pct >= 90) return "text-destructive";
  if (pct >= 75) return "text-amber-400";
  return "text-emerald-500";
}
