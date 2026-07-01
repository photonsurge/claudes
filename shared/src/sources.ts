/**
 * The SOURCE registry — the single source of truth for *who supplies what*.
 *
 * The variable registry (`variables.ts`) says what a field IS (encoding, units,
 * palette, domain). This registry says which upstream MODELS can supply that
 * field, at what resolution/cadence/priority, and over what bbox. A variable may
 * be fed by several sources (e.g. `sst` from GFS-masked as a fallback and from
 * real RTOFS); the merge resolver (Phase 2) prefers the higher `priority` inside
 * its bbox and falls back to the base elsewhere.
 *
 * Kept pure/data-only so both the worker (scheduling, URL building) and the web
 * (attribution, compositing) can read it. Env feature-flags gate *activation*
 * (see `worker/src/weather/config.ts`), not this static shape.
 */

/** How often a source publishes a new run. */
export type Cadence =
  | { kind: "cron"; runsUtc: number[] } // e.g. [0,6,12,18]
  | { kind: "interval"; minutes: number }; // e.g. satellite every 10

export type SourceFormat = "grib2" | "netcdf" | "image";
export type SourceGrid = "regular" | "icosahedral" | "gaussian-reduced" | "geostationary";

export interface SourceDescriptor {
  /** Stable id, e.g. "gfs", "ifs", "rtofs", "gfswave-0p16". */
  id: string;
  label: string;
  format: SourceFormat;
  /** Native grid family. Only "regular" is drop-in; the rest need a regrid. */
  grid: SourceGrid;
  /** Grid dimensions of the baked texture (regular sources only). */
  dims?: { width: number; height: number };
  /** Nominal resolution in degrees; smaller = finer = wins ties. */
  resolutionDeg: number;
  /** [west, south, east, north]; global = [-180,-90,180,90]. */
  bbox: [number, number, number, number];
  cadence: Cadence;
  /** Publish delay after nominal run time, in minutes (staleness guard). */
  latencyMinutes: number;
  /** Variable ids (keys into VARIABLE_REGISTRY) this source can supply. */
  variables: string[];
  /** Higher wins in overlap; regional nests > global bases. */
  priority: number;
  /** Static default; runtime activation is additionally env-gated. */
  enabled: boolean;
  /** Licence/credit line that MUST be shown wherever this data renders. */
  attribution?: string;
}

const GLOBAL_BBOX: [number, number, number, number] = [-180, -90, 180, 90];

/**
 * Phase 1 sources. GFS + GFS-Wave 0.25° are the incumbent base (untouched
 * pipeline). IFS, RTOFS and GFS-Wave 0.16° are the new drop-in GRIB suppliers.
 * Phase 2 nests (HRRR, ICON-D2) and Phase 3 (satellite) are intentionally absent
 * until their regrid/reproject paths exist.
 */
export const SOURCE_REGISTRY: Record<string, SourceDescriptor> = {
  // ── Global atmospheric base ────────────────────────────────────────────────
  gfs: {
    id: "gfs",
    label: "NOAA GFS 0.25°",
    format: "grib2",
    grid: "regular",
    dims: { width: 1440, height: 721 },
    resolutionDeg: 0.25,
    bbox: GLOBAL_BBOX,
    cadence: { kind: "cron", runsUtc: [0, 6, 12, 18] },
    latencyMinutes: 240, // ~4h product lag
    variables: ["wind", "temp", "humidity", "rain", "storm", "gust", "pressure", "sst", "cloud", "snow"],
    priority: 10,
    enabled: true,
    attribution: "NOAA/NCEP GFS",
  },
  ifs: {
    id: "ifs",
    label: "ECMWF IFS 0.25°",
    format: "grib2",
    grid: "regular",
    dims: { width: 1440, height: 721 },
    resolutionDeg: 0.25,
    bbox: GLOBAL_BBOX,
    cadence: { kind: "cron", runsUtc: [0, 6, 12, 18] },
    latencyMinutes: 540, // ~9h; worse than GFS — don't publish early
    variables: ["wind", "temp", "pressure"], // parity vars added as verified
    priority: 15, // preferred over GFS when IFS_AS_DEFAULT_BASE is on
    // Off by default: flips on via IFS_AS_DEFAULT_BASE (GFS stays as fallback).
    enabled: false,
    attribution: "© ECMWF (CC-BY-4.0)",
  },

  // ── Ocean ──────────────────────────────────────────────────────────────────
  rtofs: {
    id: "rtofs",
    label: "NOAA Global RTOFS 1/12°",
    format: "grib2",
    grid: "regular",
    // 0.08° lat-lon surface product; ~84N/72S coverage (poles are nodata).
    dims: { width: 4500, height: 1951 },
    resolutionDeg: 0.08,
    bbox: [-180, -72, 180, 84],
    cadence: { kind: "cron", runsUtc: [0] }, // one run/day (~16z publish)
    latencyMinutes: 16 * 60,
    variables: ["sst", "current", "salinity"],
    priority: 20, // real ocean model beats GFS-masked SST
    enabled: true,
    attribution: "NOAA/NCEP Global RTOFS",
  },

  // ── Waves ────────────────────────────────────────────────────────────────
  "gfswave-0p25": {
    id: "gfswave-0p25",
    label: "NOAA GFS-Wave 0.25°",
    format: "grib2",
    grid: "regular",
    dims: { width: 1440, height: 721 },
    resolutionDeg: 0.25,
    bbox: GLOBAL_BBOX,
    cadence: { kind: "cron", runsUtc: [0, 6, 12, 18] },
    latencyMinutes: 240,
    variables: ["wave"],
    priority: 10,
    enabled: false, // superseded by the 0.16° source below; kept as fallback
    attribution: "NOAA/NCEP GFS-Wave",
  },
  "gfswave-0p16": {
    id: "gfswave-0p16",
    label: "NOAA GFS-Wave 0.16°",
    format: "grib2",
    grid: "regular",
    dims: { width: 2160, height: 1141 }, // 0.16667° global lat-lon
    resolutionDeg: 0.16,
    bbox: GLOBAL_BBOX,
    cadence: { kind: "cron", runsUtc: [0, 6, 12, 18] },
    latencyMinutes: 240,
    variables: ["wave"],
    priority: 20, // finer than 0p25
    enabled: true,
    attribution: "NOAA/NCEP GFS-Wave",
  },

  // Phase 2 regional nests (HRRR, ICON-D2) and Phase 3 satellite live here once
  // their regrid/reproject paths exist — see the data-expansion spec §6/§7.
};

export const getSource = (id: string): SourceDescriptor | undefined => SOURCE_REGISTRY[id];

/** All statically-enabled sources. */
export const enabledSources = (): SourceDescriptor[] =>
  Object.values(SOURCE_REGISTRY).filter((s) => s.enabled);

/**
 * Sources that can supply `variableId`, highest-priority first (finest/nested
 * wins). The reverse index the merge resolver reads — no need to duplicate the
 * supplier list onto each variable in `variables.ts`.
 */
export const sourcesForVariable = (variableId: string): SourceDescriptor[] =>
  Object.values(SOURCE_REGISTRY)
    .filter((s) => s.variables.includes(variableId))
    .sort((a, b) => b.priority - a.priority);

/**
 * The preferred *enabled* source for a variable (highest priority). Returns
 * undefined when nothing enabled supplies it — the caller then falls back.
 */
export const preferredSource = (variableId: string): SourceDescriptor | undefined =>
  sourcesForVariable(variableId).find((s) => s.enabled);
