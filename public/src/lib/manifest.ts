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
import { getSource, isNestSource } from "@photonsurge/shared/sources";
import { getVariable } from "@photonsurge/shared/variables";

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
 * Does a bbox span (near) the whole planet? Such a nest (e.g. icon-global,
 * bbox ≈ [-180,-90,180,90]) can stand in as the always-on base for a variable
 * with no true global base, so it renders at every zoom rather than only past
 * its `minZoom`. The east edge tolerance covers grids that stop at the last cell
 * centre (icon-global's 179.75).
 */
function isGlobalCoverage(bbox?: number[]): boolean {
  if (!bbox || bbox.length < 4) return false;
  const [w, s, e, n] = bbox;
  return w <= -179 && e >= 179 && s <= -89 && n >= 89;
}

/**
 * PURE: compose ONE client manifest from the latest run of each model, picking
 * per variable the entry from the highest-`priority` GLOBAL BASE source that
 * supplies it (rtofs SST/currents/salinity > gfs-masked; gfswave-mosaic > gfs
 * wave; ifs temp/wind/pressure > gfs). Ties break to the newer run. bounds/grid/
 * steps come from the base run (the one with the most forecast steps — the global
 * atmos base), since every base bakes to global bounds. Returns null if no runs.
 *
 * Regional NEST sources (those declaring `minZoom` — HRRR, ICON-D2, MRMS radar,
 * RTOFS regional windows) do NOT compete to be the base. Instead every nest that
 * supplies a variable is attached to that variable's `nests[]`, sorted
 * coarsest→finest, and the client zoom-gates them by `bbox`/`minZoom`. A variable
 * supplied ONLY by nests (e.g. radar) still appears, with an empty-`files` base so
 * nothing renders globally — only in-region.
 *
 * Each variable keeps its own `files`/`bbox`/`validTime` semantics; the client
 * renders whatever forecast hours a variable actually has (e.g. RTOFS = f0 only),
 * so scrubbing past a source's last step simply drops that layer for those steps.
 */
export function composeManifest(allRuns: RunLike[]): WeatherManifest | null {
  // Only display sources that are ENABLED (unknown models default to shown).
  // IFS is enabled:false by default — it's CCSDS-packed and must be validated
  // before use; without honoring this it wins temp/wind/pressure and, if the
  // worker's wgrib2 can't unpack CCSDS, bakes zeros → "all purple" temperature.
  const runs = allRuns.filter((r) => getSource(r.model)?.enabled ?? true);
  if (!runs.length) return null;
  const runTime = (r: RunLike) => new Date(r.run as any).getTime();

  // Base run (bounds/grid/steps) is a GLOBAL base — never a regional nest, whose
  // tight bbox would otherwise shrink the whole manifest. Most steps, tie-break
  // highest priority. Fall back to any run only if every run is a nest.
  const baseRuns = runs.filter((r) => !isNestSource(r.model));
  const base = [...(baseRuns.length ? baseRuns : runs)].sort(
    (a, b) => (b.steps?.length ?? 0) - (a.steps?.length ?? 0) || modelPriority(b.model) - modelPriority(a.model),
  )[0];

  // Per variable: pick the winning BASE entry (today's logic, nests excluded) and
  // collect every NEST entry that supplies it for the overlay stack.
  const chosen: Record<string, { run: RunLike; entry: iWeatherVariableEntry }> = {};
  const nestRuns: Record<string, Array<{ run: RunLike; entry: iWeatherVariableEntry }>> = {};
  for (const run of runs) {
    for (const [varId, entry] of Object.entries(run.variables ?? {})) {
      if (isNestSource(run.model)) {
        (nestRuns[varId] ??= []).push({ run, entry });
        continue;
      }
      const cur = chosen[varId];
      const win =
        !cur ||
        modelPriority(run.model) > modelPriority(cur.run.model) ||
        (modelPriority(run.model) === modelPriority(cur.run.model) && runTime(run) > runTime(cur.run));
      if (win) chosen[varId] = { run, entry };
    }
  }

  /** Stamp a manifest entry with a run's supplier/timing (UI "last updated"). */
  const stamp = (vm: WeatherVariableManifest, run: RunLike, entry: iWeatherVariableEntry) => {
    vm.sourceId = entry.sourceId ?? run.model;
    vm.runTimeUtc = toIso(run.run) ?? String(run.run);
    const g = toIso(run.generatedAt);
    if (g) vm.generatedAt = g;
  };

  const variables: WeatherManifest["variables"] = {};
  // Union of variables supplied by a base and/or by nests (radar is nest-only).
  const varIds = new Set([...Object.keys(chosen), ...Object.keys(nestRuns)]);
  for (const varId of varIds) {
    const baseSel = chosen[varId];
    let vm: WeatherVariableManifest;
    // A nest entry promoted to be the base — excluded from `nests` below so it does
    // not also draw as a (coincident) overlay.
    let promotedBase: iWeatherVariableEntry | undefined;
    if (baseSel) {
      vm = variableManifest(baseSel.entry);
      stamp(vm, baseSel.run, baseSel.entry);
    } else {
      // NO true global base (temp/humidity/wind here: GFS/IFS not supplying them).
      // Promote a GLOBAL-coverage nest (icon-global, bbox spans the planet) to BE the
      // base WITH its files, so the variable renders across the whole globe at EVERY
      // zoom — not only once zoomed past a nest's minZoom, below which it went bare.
      const byPriorityAsc = [...nestRuns[varId]].sort(
        (a, b) => (getSource(a.run.model)?.priority ?? 0) - (getSource(b.run.model)?.priority ?? 0),
      );
      const globalBase = byPriorityAsc.find(({ run, entry }) =>
        isGlobalCoverage(entry.bbox ?? getSource(run.model)?.bbox),
      );
      if (globalBase) {
        vm = variableManifest(globalBase.entry); // WITH files → the always-on base
        stamp(vm, globalBase.run, globalBase.entry);
        promotedBase = globalBase.entry;
      } else {
        // Truly regional nest-only variable (e.g. MRMS radar): empty-files base so
        // nothing renders globally — only its zoom-gated nests, in-region.
        const top = byPriorityAsc.at(-1)!;
        vm = variableManifest({ ...top.entry, files: {} });
        stamp(vm, top.run, top.entry);
      }
    }

    const nests = nestRuns[varId];
    if (nests?.length) {
      vm.nests = nests
        .filter(({ entry }) => entry !== promotedBase)
        .map(({ run, entry }) => {
          const nvm = variableManifest(entry);
          const src = getSource(run.model);
          // Nests bake with their source's bbox/resolution/priority/minZoom; fall
          // back to the descriptor so the client always has what it needs to gate.
          if (src?.minZoom !== undefined) nvm.minZoom = src.minZoom;
          if (!nvm.bbox && src?.bbox) nvm.bbox = [...src.bbox];
          if (nvm.resolutionDeg === undefined && src) nvm.resolutionDeg = src.resolutionDeg;
          if (nvm.priority === undefined && src) nvm.priority = src.priority;
          stamp(nvm, run, entry);
          return nvm;
        })
        // Coarsest→finest so the finest (highest priority) draws last, on top.
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    }

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
  /** Absolute UTC time the selected map source finished creating the field. */
  generatedLabel: string;
  /**
   * Set (with the timing labels empty) for a timeless reference field — e.g.
   * "STATIC DATASET" for ETOPO elevation. UIs render `source · note` instead
   * of run/updated lines: showing a static field's ingest time would age it
   * like a forecast run ("54d ago") when the data itself never goes stale.
   */
  note?: string;
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

/** "30 Jun" — one shared formatter: `toLocaleString(locale, options)` builds a
 *  fresh Intl.DateTimeFormat per call (~0.2 ms each), and the freshness chip
 *  re-derived its two labels on every render of a cut (profiler round 24). */
let utcDayMonth: Intl.DateTimeFormat | undefined;
const formatUtcDayMonth = (d: Date): string =>
  (utcDayMonth ??= new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })).format(d);

/** Absolute UTC label like "30 Jun 00:00 UTC" (empty on bad input). */
export function utcLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mon = formatUtcDayMonth(d);
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
  // Timeless reference fields (elevation/ETOPO): the stored run time is only
  // when we last INGESTED the dataset, so show its vintage, never an age.
  const staticDataset = variableId ? getVariable(variableId)?.staticDataset : undefined;
  if (staticDataset) {
    return {
      source: staticDataset.toUpperCase(),
      updatedLabel: "",
      runLabel: "",
      generatedLabel: "",
      note: "STATIC DATASET",
    };
  }
  const v = variableId ? manifest.variables[variableId] : undefined;
  const source = (v?.sourceId ?? manifest.model ?? "").toUpperCase();
  const runTimeUtc = v?.runTimeUtc ?? manifest.run;
  const stamp = v?.generatedAt ?? manifest.generatedAt ?? runTimeUtc;
  return {
    source: source || "—",
    runTimeUtc,
    updatedLabel: ageLabel(stamp, nowMs),
    runLabel: utcLabel(runTimeUtc),
    generatedLabel: utcLabel(stamp),
  };
}

/**
 * Backstop interval for refetching the manifest.
 *
 * A newly published run normally arrives as a `WEATHER_RUN` socket event. If
 * that event is ever missed — a socket drop, a publish landing during a
 * reconnect — nothing else refetches, and a 24/7 broadcast would sit on the
 * maps it loaded at start-up for the rest of the day. This poll is the safety
 * net: the manifest is small JSON, so once every few minutes costs nothing next
 * to being stuck on stale weather.
 */
export const MANIFEST_POLL_MS = 5 * 60_000;

/**
 * One `[globe]` line naming exactly which weather is on air: model, run time,
 * how old that run is, how many steps it carries and which forecast hour is
 * being drawn.
 *
 * Written because a screenshot of a near-calm wind field under a live
 * damaging-wind warning has two very different explanations — the field is
 * sampled wrong, or it is faithfully drawn from a run that is a day or two
 * old while the alert polygon beside it is current — and
 * nothing in a CPU profile or a screenshot tells the two apart. The age does.
 * A run age in hours means the wind is current and the sampling is suspect; a
 * run age in days means the wind is stale and the pipeline is (see the
 * `MANIFEST_POLL_MS` backstop for the client half of that).
 */
export function manifestLogLine(
  m: Pick<WeatherManifest, "model" | "run" | "steps">,
  fhr: number,
  nowMs: number = Date.now(),
): string {
  return `[globe] manifest ${m.model ?? "?"} run=${m.run ?? "?"} (${ageLabel(m.run, nowMs)}) steps=${m.steps?.length ?? 0} fhr=${fhr}`;
}

/**
 * A cheap digest of everything the globe actually renders from. Two manifests
 * that digest the same are interchangeable.
 *
 * Needed because `WEATHER_RUN` fires more often than a run actually changes —
 * the 2026-09-10 00:12 globe log shows TEN manifest replacements in twelve
 * minutes, every one of them reporting the same `run=2026-09-09T18:00Z`. Each
 * replacement was a fresh object, and `manifest` is a dependency of Globe's
 * weather-layer effect, so identical data was rebuilding the whole weather
 * stack ten times over — the same identity-churn class as round 14's
 * `mergeControlState` and the alert overlay's `featureSetFingerprint`.
 *
 * Digests the per-variable texture ids rather than just `run`/`generatedAt`, so
 * a re-bake that republishes new textures under the same run still counts as a
 * change (~20 variables, not the ~1 000 step entries).
 */
export function manifestFingerprint(m: WeatherManifest | null): string {
  if (!m) return "";
  const parts = [m.model ?? "", m.run ?? "", m.generatedAt ?? "", String(m.steps?.length ?? 0)];
  for (const [id, v] of Object.entries(m.variables ?? {})) {
    parts.push(`${id}:${v?.files?.["0"] ?? ""}:${v?.nests?.length ?? 0}`);
  }
  return parts.join("|");
}

/** Keep `prev` when the incoming manifest renders identically — identity
 *  stability is what stops a no-op `WEATHER_RUN` rebuilding every layer. */
export function pickManifest(
  prev: WeatherManifest | null,
  next: WeatherManifest | null,
): WeatherManifest | null {
  if (!next) return prev;
  return manifestFingerprint(prev) === manifestFingerprint(next) ? prev : next;
}

/** Client: fetch the current manifest (or null if no run is published). */
export async function fetchManifest(): Promise<WeatherManifest | null> {
  const res = await fetch("/api/weather/manifest", { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json || json.run === null) return null;
  return json as WeatherManifest;
}
