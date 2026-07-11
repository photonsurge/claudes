import type { iAirEntry, iAirRun } from "@photonsurge/shared/db/air-log-model";
import type { SegmentKind } from "@photonsurge/shared/director";

/** Wire shapes from /api/admin/runs — shared types plus JSON-serialised dates. */
export type AirRun = Omit<iAirRun, "startedAt" | "endedAt" | "lastCutAt"> & {
  id: string;
  startedAt: string;
  endedAt?: string;
  lastCutAt?: string;
};
export type AirEntry = Omit<iAirEntry, "startedAt" | "endedAt"> & {
  id: string;
  startedAt: string;
  endedAt?: string;
};

/** A run with no end mark is live only while cuts keep landing — after this
 *  long without one it's presumed orphaned (worker died mid-session). */
const LIVE_STALE_MS = 15 * 60 * 1000;

export function runIsLive(run: AirRun, nowMs = Date.now()): boolean {
  if (run.endedAt) return false;
  const lastBeat = run.lastCutAt ?? run.startedAt;
  return nowMs - new Date(lastBeat).getTime() < LIVE_STALE_MS;
}

/** Wall-clock length of a run so far (live runs measure up to `nowMs`). */
export function runDurationMs(run: AirRun, nowMs = Date.now()): number {
  const end = run.endedAt ? new Date(run.endedAt).getTime() : nowMs;
  return Math.max(0, end - new Date(run.startedAt).getTime());
}

/** "1h 04m" / "12m 05s" / "45s" — compact duration for run/entry readouts. */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Per-kind chip colour on the runs timeline — grouped by story family:
 *  world views cool blue, live hazards hot, curated features green, ads gold. */
export const KIND_COLORS: Partial<Record<SegmentKind, string>> & { default: string } = {
  intro: "#60a5fa",
  ocean: "#38bdf8",
  orbital: "#818cf8",
  country: "#4ade80",
  weather: "#a3e635",
  storm: "#f97316",
  volcano: "#f43f5e",
  quake: "#fbbf24",
  flight: "#22d3ee",
  ship: "#2dd4bf",
  ad: "#eab308",
  default: "#8b95a7",
};

export const kindColor = (kind: string): string =>
  KIND_COLORS[kind as SegmentKind] ?? KIND_COLORS.default;

export async function listRuns(): Promise<{ runs: AirRun[]; sceneNames: Record<string, string> }> {
  const res = await fetch("/api/admin/runs");
  if (!res.ok) return { runs: [], sceneNames: {} };
  const body = await res.json();
  return { runs: body.runs ?? [], sceneNames: body.sceneNames ?? {} };
}

export async function getRun(
  id: string,
): Promise<{ run: AirRun; entries: AirEntry[]; sceneName: string } | null> {
  const res = await fetch(`/api/admin/runs/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return res.json();
}
