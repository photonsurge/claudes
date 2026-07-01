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
export type SourceGrid =
  | "regular"
  | "curvilinear" // 2-D lon/lat coord arrays, e.g. RTOFS tripolar HYCOM
  | "icosahedral"
  | "gaussian-reduced"
  | "geostationary";

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
  // NOTE (verified against live NOMADS 2026): there is NO global RTOFS GRIB2.
  // GRIB2 exists only as 11 regional windows that don't tile the globe. The
  // GLOBAL surface product (SST/salinity/currents in the `_prog` bundle) is
  // netCDF on the native tripolar 1/12° HYCOM grid → needs curvilinear regrid
  // (worker/src/regrid/curvilinear.ts). 00z run only, ~8h latency.
  rtofs: {
    id: "rtofs",
    label: "NOAA Global RTOFS 1/12° (netCDF)",
    format: "netcdf",
    grid: "curvilinear",
    // Regridded target (global regular lat-lon); ~72°S–90°N useful coverage.
    dims: { width: 4320, height: 2160 }, // 1/12° global target for the regrid
    resolutionDeg: 0.083,
    bbox: [-180, -80, 180, 90],
    cadence: { kind: "cron", runsUtc: [0] }, // one 00z run/day
    latencyMinutes: 8 * 60, // ~8h; poll rather than trust a fixed time
    variables: ["sst", "current", "salinity"],
    priority: 20, // real ocean model beats GFS-masked SST
    enabled: true,
    attribution: "NOAA/NCEP Global RTOFS",
  },

  // ── Waves ────────────────────────────────────────────────────────────────
  // NOTE: NOAA does NOT publish a genuine global 0.16° wave grid — `global.0p16`
  // is only a 52.5°N–15°S band (2160×406). The whole-planet grid is `global.0p25`
  // (1440×721, ±90°). A finer-than-0.25° global field must be MOSAICKED from the
  // regional tiles (see WAVE_TILES in worker/src/sources/gfswave.ts) — that's the
  // `gfswave-mosaic` product below, composited server-side (worker/src/merge).
  "gfswave-0p25": {
    id: "gfswave-0p25",
    label: "NOAA GFS-Wave 0.25° (global)",
    format: "grib2",
    grid: "regular",
    dims: { width: 1440, height: 721 },
    resolutionDeg: 0.25,
    bbox: GLOBAL_BBOX,
    cadence: { kind: "cron", runsUtc: [0, 6, 12, 18] },
    latencyMinutes: 240,
    variables: ["wave"],
    priority: 10, // whole-planet base / mosaic fallback
    enabled: true,
    attribution: "NOAA/NCEP GFS-Wave",
  },
  "gfswave-mosaic": {
    id: "gfswave-mosaic",
    label: "NOAA GFS-Wave (regional mosaic, ~0.16°)",
    format: "grib2",
    grid: "regular",
    dims: { width: 2160, height: 1081 }, // global 1/6° lat-lon target
    resolutionDeg: 0.16,
    bbox: GLOBAL_BBOX,
    cadence: { kind: "cron", runsUtc: [0, 6, 12, 18] },
    latencyMinutes: 240,
    variables: ["wave"],
    priority: 20, // finer than the 0p25 global base
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
