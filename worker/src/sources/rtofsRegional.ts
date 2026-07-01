// sources/rtofsRegional.ts
// Pure helpers for the NOAA RTOFS REGIONAL GRIB2 windows (Phase 2e). Network is
// always injected so these functions are unit-testable.
//
// RTOFS publishes GRIB2 only as a set of REGIONAL windows (they do NOT tile the
// globe) at 1/12°. Files live under the same rtofs.<date>/ directory as the
// global 2ds netCDF and are named:
//
//   rtofs_glo.t00z.{n|f}024_<region>_std.grb2
//
// (verified from a live NOMADS `rtofs.<date>/` listing, 2026). Each carries
// WTMP (→ sst), UOGRD/VOGRD (→ current), and PRACTSAL (→ salinity) on a regular
// lat-lon grid. We publish each as a zoom-gated NEST over the global `rtofs`
// base (see shared/src/sources.rtofsRegional.ts).
//
// The descriptor registry (shared/src/sources.rtofsRegional.ts) is the source of
// truth for each window's bbox/dims/variables; this file adds the NOMADS token
// (filename fragment) and the GRIB2 -match tokens per app variable, and derives
// per-window target dims FROM the descriptor so the baked grid matches.

import { getSource } from "@photonsurge/shared/sources";

const NOMADS_PROD = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod";

/**
 * GRIB2 -match tokens per app variable, for the regional *_std.grb2 windows.
 *
 * VERIFY (against a live `wgrib2 <window>.grb2 -match` inventory): the native
 * regional windows use WTMP (water temperature — note: nominally KELVIN in
 * GRIB2, so bake SST with a K→°C convert, UNLIKE the cdo-converted global product
 * which already sits in °C). UOGRD/VOGRD are the ocean current components;
 * salinity is SALTY. If a window omits a variable, the worker skips it.
 *
 * VERIFIED (live wgrib2 inventory of rtofs_glo.t00z.n024_west_atl_std.grb2 +
 * trop_paci_lowres, 2026-07): the regional *_std.grb2 windows carry WTMP / UOGRD /
 * VOGRD / SALTY (NOT PRACTSAL — that token matched nothing, so salinity baked
 * empty on every window).
 */
export const RTOFS_REGIONAL_VAR_MATCH: Record<
  string,
  { encoding: "scalar" | "uv"; match: string[] }
> = {
  sst: { encoding: "scalar", match: [":WTMP:"] }, // WTMP in K on native windows (bake K→°C)
  current: { encoding: "uv", match: [":UOGRD:", ":VOGRD:"] },
  salinity: { encoding: "scalar", match: [":SALTY:"] }, // regional windows code salinity as SALTY
};

/** One RTOFS regional window: descriptor id → NOMADS filename token → geometry. */
export interface RtofsWindow {
  /** SourceDescriptor id, e.g. "rtofs-westatl". */
  sourceId: string;
  /** NOMADS filename token, e.g. "west_atl" → ..._west_atl_std.grb2. */
  token: string;
  /** [W,S,E,N] window extent (mirrors the descriptor bbox). */
  bbox: [number, number, number, number];
  /** Baked-texture grid dims (mirror the descriptor dims). */
  dims: { width: number; height: number };
  /** App-variable ids this window carries (mirror the descriptor variables). */
  variables: string[];
}

/**
 * descriptor id → NOMADS filename token. The descriptor (shared) owns the bbox /
 * dims / variables; this map just supplies the filename fragment that shared
 * can't know. Every id here MUST exist in RTOFS_REGIONAL_SOURCES.
 *
 * VERIFY: tokens are the exact live NOMADS filename fragments from a
 * `rtofs.<date>/` listing (rtofs_glo.t00z.n024_<token>_std.grb2).
 */
export const RTOFS_REGIONAL_TOKENS: Record<string, string> = {
  "rtofs-westatl": "west_atl",
  "rtofs-westconus": "west_conus",
  "rtofs-alaska": "alaska",
  "rtofs-gulfalaska": "gulf_alaska",
  "rtofs-bering": "bering",
  "rtofs-arctic": "arctic",
  "rtofs-hudsonbaffin": "hudson_baffin",
  "rtofs-hawaii": "honolulu",
  "rtofs-guam": "guam",
  "rtofs-samoa": "samoa",
  "rtofs-troppac": "trop_paci_lowres",
};

/**
 * The full window table, built by joining RTOFS_REGIONAL_TOKENS with each
 * window's SourceDescriptor (bbox/dims/variables). Throws if a token id is not a
 * registered source — keeps the two lists in lock-step.
 */
export const RTOFS_WINDOWS: RtofsWindow[] = Object.entries(RTOFS_REGIONAL_TOKENS).map(
  ([sourceId, token]) => {
    const src = getSource(sourceId);
    if (!src) throw new Error(`rtofsRegional: no SourceDescriptor for ${sourceId}`);
    const dims = src.dims ?? { width: 1, height: 1 };
    return {
      sourceId,
      token,
      bbox: src.bbox,
      dims: { width: dims.width, height: dims.height },
      variables: src.variables,
    };
  },
);

/** Look up a window by its descriptor id. */
export function rtofsWindow(sourceId: string): RtofsWindow | undefined {
  return RTOFS_WINDOWS.find((w) => w.sourceId === sourceId);
}

/** Zero-pad an RTOFS regional forecast/nowcast hour to 3 digits. */
export function padRegionalHour(hour: number): string {
  return String(hour).padStart(3, "0");
}

export interface BuildRtofsRegionalUrlArgs {
  /** Run date as YYYYMMDD (UTC). */
  date: string;
  /** NOMADS region token, e.g. "west_atl". */
  token: string;
  /** Forecast (f) / nowcast (n) hour; the daily rollup is 024. */
  hour?: number;
  /** Nowcast ("n", the analysis) vs forecast ("f"). Default nowcast. */
  kind?: "n" | "f";
}

/**
 * Build the NOMADS URL for one RTOFS regional GRIB2 window.
 *
 * Example (west_atl, nowcast +24h):
 *   https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/rtofs.20260701/
 *     rtofs_glo.t00z.n024_west_atl_std.grb2
 *
 * VERIFY: cycle is always t00z (RTOFS is a single 00z run/day); the daily rollup
 * hour is 024 and the nowcast (`n`) is the analysis field we bake as fhr 0.
 */
export function buildRtofsRegionalUrl({
  date,
  token,
  hour = 24,
  kind = "n",
}: BuildRtofsRegionalUrlArgs): string {
  const hhh = padRegionalHour(hour);
  return `${NOMADS_PROD}/rtofs.${date}/rtofs_glo.t00z.${kind}${hhh}_${token}_std.grb2`;
}

// Re-export the shared run resolver (regional windows share the global RTOFS
// cycle timing: one 00z run/day, ~8h latency).
export { rtofsLatestAvailableRun, rtofsCandidateRuns, RTOFS_LATENCY_HOURS } from "./rtofs";
