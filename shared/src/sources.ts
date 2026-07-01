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
import { WAVE_NEST_SOURCES } from "./sources.waveNests";
import { RTOFS_REGIONAL_SOURCES } from "./sources.rtofsRegional";
import { ICON_GLOBAL_SOURCES } from "./sources.iconGlobal";
import { HRDPS_SOURCES } from "./sources.hrdps";
import { UKV_SOURCES } from "./sources.ukv";
import { OPENMETEO_SOURCES } from "./sources.openMeteo";

/** How often a source publishes a new run. */
export type Cadence =
  | { kind: "cron"; runsUtc: number[] } // e.g. [0,6,12,18]
  | { kind: "interval"; minutes: number }; // e.g. satellite every 10

export type SourceFormat = "grib2" | "netcdf" | "image";
export type SourceGrid =
  | "regular"
  | "curvilinear" // 2-D lon/lat coord arrays, e.g. RTOFS tripolar HYCOM
  | "lambert" // Lambert conformal conic, e.g. HRRR CONUS — regrid to regular via wgrib2
  | "rotated" // rotated lat-lon pole, e.g. ECCC HRDPS — regrid to regular via wgrib2
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
  /**
   * Regional NEST activation floor: the source is treated as a zoom-gated
   * regional overlay (not a global base) when this is set. The client renders it
   * only when the camera zoom ≥ `minZoom` AND the view centre is inside `bbox`.
   * Omit for global bases (gfs, ifs, rtofs, gfswave-*): they always render.
   * Absent → the merge resolver derives a default from `resolutionDeg`.
   */
  minZoom?: number;
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

  // ── Phase 2 regional NESTS (zoom-gated high-res overlays) ───────────────────
  // Each declares `minZoom`, so the merge resolver treats it as an overlay on top
  // of the global base rather than a competing base (see `isNestSource`). They
  // render only when the camera zooms into their `bbox`. `enabled: true` just
  // means "include if a run exists" — no data (and no cost) until the matching
  // worker ingest is wired + scheduled and actually publishes a run.

  // EU — DWD ICON-D2, 2.2 km central Europe, regular-lat-lon variant (drop-in).
  "icon-d2": {
    id: "icon-d2",
    label: "DWD ICON-D2 2.2 km (Europe)",
    format: "grib2",
    grid: "regular",
    dims: { width: 1215, height: 746 },
    resolutionDeg: 0.02,
    // The exact DWD ICON-D2 regular-lat-lon grid: 1215×746 points at 0.02°,
    // origin −3.94/43.18 → extent −3.94+1214·0.02=20.34, 43.18+745·0.02=58.08.
    // MUST match dims·res exactly or the baked texture is displayed stretched
    // (the client uses this bbox as the RasterLayer bounds and the bake origin).
    bbox: [-3.94, 43.18, 20.34, 58.08],
    cadence: { kind: "cron", runsUtc: [0, 3, 6, 9, 12, 15, 18, 21] },
    latencyMinutes: 120,
    variables: ["temp", "wind", "gust", "humidity"],
    priority: 30, // nest: beats ICON-EU + the GFS/IFS global base inside its bbox
    minZoom: 3.5,
    enabled: true,
    attribution: "© Deutscher Wetterdienst (DWD)",
  },

  // EU-wide — DWD ICON-EU 6.5 km. Coarser than ICON-D2 but covers ALL of Europe
  // (Ireland, UK, Iberia, Scandinavia, E. Europe) where the D2 central-Europe box
  // misses. Exact regular-lat-lon grid: 1097×657 @ 0.0625°, origin −23.5/29.5 →
  // extent −23.5+1096·0.0625=45.0, 29.5+656·0.0625=70.5 (bbox = dims·res exactly).
  "icon-eu": {
    id: "icon-eu",
    label: "DWD ICON-EU 6.5 km (Europe)",
    format: "grib2",
    grid: "regular",
    dims: { width: 1097, height: 657 },
    resolutionDeg: 0.0625,
    bbox: [-23.5, 29.5, 45.0, 70.5],
    cadence: { kind: "cron", runsUtc: [0, 6, 12, 18] },
    latencyMinutes: 150,
    variables: ["temp", "wind", "gust", "humidity"],
    priority: 28, // below ICON-D2 (30): D2's 2.2 km wins in central Europe overlap
    minZoom: 3, // activates a touch sooner/wider than D2 (3.5), covering UK/EU
    enabled: true,
    attribution: "© Deutscher Wetterdienst (DWD)",
  },

  // US — NOAA HRRR 3 km CONUS. Native Lambert conformal → wgrib2-regridded to a
  // regular lat-lon subset before bake (reuses the wave-mosaic regrid path).
  hrrr: {
    id: "hrrr",
    label: "NOAA HRRR 3 km (CONUS)",
    format: "grib2",
    grid: "lambert",
    dims: { width: 2600, height: 1100 }, // regular-latlon regrid target (~0.028°)
    resolutionDeg: 0.028,
    bbox: [-134, 21, -60, 53], // HRRR CONUS extent
    cadence: { kind: "interval", minutes: 60 }, // hourly runs
    latencyMinutes: 90,
    variables: ["temp", "wind", "gust"],
    priority: 30,
    minZoom: 3.5,
    enabled: true,
    attribution: "NOAA/NCEP HRRR",
  },

  // US — MRMS reflectivity mosaic, ~1 km CONUS. NEST-ONLY variable `radar`
  // (no global base): renders only inside this bbox. The headline live layer
  // (~2-min cadence). Baked at ~0.02° to keep the texture broadcast-sized.
  mrms: {
    id: "mrms",
    label: "NOAA MRMS radar (CONUS)",
    format: "grib2",
    grid: "regular",
    dims: { width: 3500, height: 1750 }, // ~0.02° bake of the 0.01° native mosaic
    resolutionDeg: 0.02,
    bbox: [-130, 20, -60, 55], // MRMS CONUS domain
    cadence: { kind: "interval", minutes: 2 },
    latencyMinutes: 5,
    variables: ["radar"],
    priority: 40, // finest live layer; above the forecast nests where they overlap
    minZoom: 3,
    enabled: true,
    attribution: "NOAA/NCEP MRMS",
  },

  // Phase 2a wave-basin nests + Phase 2e RTOFS regional windows are spread in
  // below (kept in their own files so each adapter owns its descriptors). Phase 3
  // satellite lives here once its reproject path exists (data-expansion §6/§7).
  ...WAVE_NEST_SOURCES,
  ...RTOFS_REGIONAL_SOURCES,
  ...ICON_GLOBAL_SOURCES,
  ...HRDPS_SOURCES,
  ...UKV_SOURCES,
  ...OPENMETEO_SOURCES,
};

export const getSource = (id: string): SourceDescriptor | undefined => SOURCE_REGISTRY[id];

/**
 * A source is a regional NEST (zoom-gated overlay) rather than a global base
 * exactly when it declares `minZoom`. Classifying by `minZoom` (not by bbox)
 * keeps sub-global bases like RTOFS (−80..90°) and the wave mosaic as always-on
 * bases; only sources that opt in with `minZoom` become nests. Unknown ids are
 * treated as non-nest bases.
 */
export const isNestSource = (id: string): boolean => SOURCE_REGISTRY[id]?.minZoom !== undefined;

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
