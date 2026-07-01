/**
 * Manifest client helpers + the PURE run→manifest mapping shared with the
 * `/api/weather/manifest` route handler.
 *
 * The mapping rewrites each variable's `files` map from stored texture *ids*
 * into fetchable URLs (`/api/weather/tex/<id>`) using the shared `textureUrl`.
 * Keeping it pure means the route can reuse it and tests can assert on it
 * without a database.
 */
import { textureUrl, type WeatherManifest, type WeatherVariableManifest } from "@photonsurge/shared/manifest";
import type { iWeatherRun, iWeatherVariableEntry } from "@photonsurge/shared/db/weather-run-model";
import { getSource } from "@photonsurge/shared/sources";

/** The subset of a run we read when building the client manifest. */
export type RunLike = Pick<
  iWeatherRun,
  "model" | "run" | "generatedAt" | "bounds" | "grid" | "steps" | "variables"
>;

/** PURE: one variable entry (stored) → client manifest form (ids → URLs). */
function variableManifest(entry: iWeatherVariableEntry): WeatherVariableManifest {
  const files: Record<string, string> = {};
  for (const [fhr, textureId] of Object.entries(entry.files ?? {})) {
    files[fhr] = textureUrl(textureId);
  }
  return {
    encoding: entry.encoding,
    units: entry.units,
    ...(entry.domain ? { domain: entry.domain } : {}),
    ...(entry.palette ? { palette: entry.palette } : {}),
    ...(entry.imageUnscale ? { imageUnscale: entry.imageUnscale } : {}),
    ...(entry.vectorUnscale ? { vectorUnscale: entry.vectorUnscale } : {}),
    ...(entry.sourceId ? { sourceId: entry.sourceId } : {}),
    ...(entry.resolutionDeg !== undefined ? { resolutionDeg: entry.resolutionDeg } : {}),
    ...(entry.bbox ? { bbox: entry.bbox } : {}),
    ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
    files,
  };
}

/** ISO-normalise a Date | string | undefined. */
function toIso(value: Date | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString();
  // Already a string (e.g. mongoose .lean() may hand back a string/Date).
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

/**
 * PURE: build a client `WeatherManifest` from a published run, rewriting texture
 * ids into URLs. Throws nothing; missing optional fields are simply omitted.
 */
export function buildManifestFromRun(run: RunLike): WeatherManifest {
  const variables: WeatherManifest["variables"] = {};
  for (const [id, entry] of Object.entries(run.variables ?? {})) {
    variables[id] = variableManifest(entry);
  }

  const generatedAt = toIso(run.generatedAt);

  return {
    model: run.model,
    run: toIso(run.run) ?? String(run.run),
    ...(generatedAt ? { generatedAt } : {}),
    bounds: run.bounds,
    grid: run.grid,
    steps: run.steps,
    variables,
  };
}

/** Source priority for a run's model (higher wins in overlap); 0 if unknown. */
const modelPriority = (model: string): number => getSource(model)?.priority ?? 0;

/**
 * PURE: compose ONE client manifest from the latest run of each model, picking
 * per variable the entry from the highest-`priority` source that supplies it
 * (rtofs SST/currents/salinity > gfs-masked; gfswave-mosaic > gfs wave; ifs
 * temp/wind/pressure > gfs). Ties break to the newer run. bounds/grid/steps come
 * from the base run (the one with the most forecast steps — the global atmos
 * base), since every source bakes to global bounds. Returns null if no runs.
 *
 * Each variable keeps its own `files`/`bbox`/`validTime` semantics; the client
 * renders whatever forecast hours a variable actually has (e.g. RTOFS = f0 only),
 * so scrubbing past a source's last step simply drops that layer for those steps.
 */
export function composeManifest(runs: RunLike[]): WeatherManifest | null {
  if (!runs.length) return null;
  const runTime = (r: RunLike) => new Date(r.run as any).getTime();

  // Base = most forecast steps, tie-break highest model priority (→ gfs/ifs base).
  const base = [...runs].sort(
    (a, b) => (b.steps?.length ?? 0) - (a.steps?.length ?? 0) || modelPriority(b.model) - modelPriority(a.model),
  )[0];

  // Per variable, keep the entry from the winning run.
  const chosen: Record<string, { run: RunLike; entry: iWeatherVariableEntry }> = {};
  for (const run of runs) {
    for (const [varId, entry] of Object.entries(run.variables ?? {})) {
      const cur = chosen[varId];
      const win =
        !cur ||
        modelPriority(run.model) > modelPriority(cur.run.model) ||
        (modelPriority(run.model) === modelPriority(cur.run.model) && runTime(run) > runTime(cur.run));
      if (win) chosen[varId] = { run, entry };
    }
  }

  const variables: WeatherManifest["variables"] = {};
  for (const [varId, { run, entry }] of Object.entries(chosen)) {
    const vm = variableManifest(entry);
    // Tag with the WINNING run's timing/source so the UI can show "last updated"
    // per active map (sources refresh at different cadences).
    vm.sourceId = entry.sourceId ?? run.model;
    vm.runTimeUtc = toIso(run.run) ?? String(run.run);
    const g = toIso(run.generatedAt);
    if (g) vm.generatedAt = g;
    variables[varId] = vm;
  }

  const generatedAt = toIso(base.generatedAt);
  return {
    model: "composite",
    run: toIso(base.run) ?? String(base.run),
    ...(generatedAt ? { generatedAt } : {}),
    bounds: base.bounds,
    grid: base.grid,
    steps: base.steps,
    variables,
  };
}

export interface MapFreshness {
  /** Supplier label, e.g. "RTOFS", "IFS", "GFS", "MOSAIC". */
  source: string;
  /** ISO run/init time of the active variable's source (or the composite base). */
  runTimeUtc?: string;
  /** Short "updated 2h ago" style age, from generatedAt (or run time). */
  updatedLabel: string;
  /** Absolute UTC run time, e.g. "30 Jun 00:00 UTC". */
  runLabel: string;
}

/** Format a ms age as a compact "just now / 5m / 3h / 2d ago". */
export function ageLabel(fromIso: string | undefined, nowMs: number): string {
  if (!fromIso) return "unknown";
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Absolute UTC label like "30 Jun 00:00 UTC" (empty on bad input). */
export function utcLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mon = d.toLocaleString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${mon} ${hm} UTC`;
}

/**
 * PURE: freshness of the ACTIVE map (variable) — its supplier + when it was last
 * updated. Falls back to the composite base run when a variable carries no
 * per-source timing (single-source manifests). Returns null if nothing usable.
 */
export function mapFreshness(
  manifest: WeatherManifest | null,
  variableId: string | null,
  nowMs: number,
): MapFreshness | null {
  if (!manifest) return null;
  const v = variableId ? manifest.variables[variableId] : undefined;
  const source = (v?.sourceId ?? manifest.model ?? "").toUpperCase();
  const runTimeUtc = v?.runTimeUtc ?? manifest.run;
  const stamp = v?.generatedAt ?? manifest.generatedAt ?? runTimeUtc;
  return {
    source: source || "—",
    runTimeUtc,
    updatedLabel: ageLabel(stamp, nowMs),
    runLabel: utcLabel(runTimeUtc),
  };
}

/** Client: fetch the current manifest (or null if no run is published). */
export async function fetchManifest(): Promise<WeatherManifest | null> {
  const res = await fetch("/api/weather/manifest", { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json || json.run === null) return null;
  return json as WeatherManifest;
}
