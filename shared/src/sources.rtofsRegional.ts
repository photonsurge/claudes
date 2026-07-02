/**
 * RTOFS regional-window NEST sources (Phase 2e). NOAA RTOFS publishes GRIB2 only
 * as a set of regional windows (they do NOT tile the globe) at 1/12°, carrying
 * WTMP (sst), UOGRD/VOGRD (current), and salinity. Each window is published as a
 * zoom-gated overlay on top of the global (regridded) `rtofs` base. Each declares
 * `minZoom`, so `isNestSource` treats it as a nest.
 *
 * Spread into `SOURCE_REGISTRY` by `sources.ts`. Kept in its own file so the
 * RTOFS-regional adapter can own its descriptors without contending on
 * `sources.ts`. The `sst`/`current`/`salinity` variables already exist.
 *
 * The window token set is the LIVE NOMADS regional GRIB2 output (verified from a
 * live `rtofs.<date>/` listing, 2026): the files are
 *   rtofs_glo.t00z.{n|f}024_<region>_std.grb2
 * for regions: alaska, arctic, bering, guam, gulf_alaska, honolulu,
 * hudson_baffin, samoa, trop_paci_lowres, west_atl, west_conus.
 *
 * NOTE (design, mirrors the wave-basin nests): each window keeps its OWN native
 * regional 1/12° regular lat-lon grid + bbox — no regrid-to-global. The worker
 * subsets/bakes the window GRIB2 at the descriptor bbox/dims and the client
 * stacks it over the global `rtofs` base by `priority` inside `bbox`.
 *
 * Priority ladder for sst/current/salinity: gfs-masked sst (10) < global rtofs
 * (20) < these regional windows (25) — the native window wins where it overlaps
 * the global base, and the global base still fills everywhere the windows don't.
 *
 * VERIFY (against a live RTOFS regional GRIB2 header, e.g. `wgrib2 -grid` +
 * `-var`):
 *   - The regional windows are truly REGULAR lat-lon (grid: "regular"). RTOFS's
 *     native ocean grid is tripolar/curvilinear, but the *_std.grb2 regional
 *     products are the interpolated regular-latlon "standard" grids — confirm.
 *   - Each `bbox` [W,S,E,N] below is a best-estimate of the published window
 *     extent from the region name; confirm exact extents from `wgrib2 -grid`.
 *   - Which variables each window actually carries: not all windows publish all
 *     of WTMP/UOGRD/VOGRD/PRACTSAL — trim `variables` per window from a live
 *     inventory (the worker skips a missing variable rather than failing).
 */
import type { SourceDescriptor } from "./sources";

/** All RTOFS regional windows share cadence/latency/priority/minZoom. */
const RTOFS_REGIONAL_CADENCE = { kind: "cron" as const, runsUtc: [0] }; // one 00z run/day
const RTOFS_REGIONAL_PRIORITY = 25; // above global rtofs (20): native window wins in overlap
const RTOFS_REGIONAL_MINZOOM = 3;
const RTOFS_REGIONAL_LATENCY = 8 * 60; // ~8h, same product lag as the global RTOFS base
const RTOFS_REGIONAL_VARS = ["sst", "current", "salinity"];

/**
 * Geometry per window, MEASURED from a live `wgrib2 -grid` of each *_std.grb2
 * (2026-07). These are the source of truth for first-render / debug outlines; the
 * worker RE-PROBES each file at ingest and publishes the probed bounds, so a
 * future NOMADS grid change self-corrects rather than shearing (that silent
 * mismatch was the original striping bug).
 *
 * `bounds` is [W,S,E,N] anchored at wrapLon(lon0); E may exceed 180 where the
 * window straddles the antimeridian (the periodic globe renders it across the
 * dateline). `res` is the true grid spacing.
 */
interface RtofsGeom {
  bbox: [number, number, number, number];
  dims: { width: number; height: number };
  res: number;
  /** false → coarser than the global 1/12° base, kept out of the overlay stack. */
  enabled?: boolean;
}

function rtofsNest(
  id: string,
  label: string,
  geom: RtofsGeom,
  variables: string[] = RTOFS_REGIONAL_VARS,
): SourceDescriptor {
  return {
    id,
    label,
    format: "grib2",
    grid: "regular", // *_std.grb2 regional windows are regular lat-lon (verified)
    dims: geom.dims,
    resolutionDeg: geom.res,
    bbox: geom.bbox,
    cadence: RTOFS_REGIONAL_CADENCE,
    latencyMinutes: RTOFS_REGIONAL_LATENCY,
    variables,
    priority: RTOFS_REGIONAL_PRIORITY,
    minZoom: RTOFS_REGIONAL_MINZOOM,
    enabled: geom.enabled ?? true,
    attribution: "NOAA/NCEP Global RTOFS",
  };
}

export const RTOFS_REGIONAL_SOURCES: Record<string, SourceDescriptor> = {
  // US East Coast + W. Atlantic. lon 260..306 → −100..−54, lat 10..44.8, 0.08°.
  "rtofs-westatl": rtofsNest("rtofs-westatl", "NOAA RTOFS 1/12° (US East / W. Atlantic)", {
    bbox: [-100, 10, -54, 44.8],
    dims: { width: 575, height: 435 },
    res: 0.08,
  }),
  // US West Coast. lon 210..260 → −150..−100, lat 10..60, 0.08°.
  "rtofs-westconus": rtofsNest("rtofs-westconus", "NOAA RTOFS 1/12° (US West Coast)", {
    bbox: [-150, 10, -100, 60],
    dims: { width: 625, height: 625 },
    res: 0.08,
  }),
  // Alaska. DISABLED: native grid is 0.30° (350×150) — COARSER than the global
  // 1/12° base, so as a higher-priority overlay it would replace finer data.
  "rtofs-alaska": rtofsNest("rtofs-alaska", "NOAA RTOFS 0.3° (Alaska)", {
    bbox: [140, 40, 245, 85], // lon 140..245 (crosses 180)
    dims: { width: 350, height: 150 },
    res: 0.3,
    enabled: false,
  }),
  // Gulf of Alaska. DISABLED: native grid is 0.50° (84×45) — far coarser than base.
  "rtofs-gulfalaska": rtofsNest("rtofs-gulfalaska", "NOAA RTOFS 0.5° (Gulf of Alaska)", {
    bbox: [-165, 40, -123, 62.5], // lon 195..237 → −165..−123
    dims: { width: 84, height: 45 },
    res: 0.5,
    enabled: false,
  }),
  // Bering Sea. lon 155..211 (crosses 180 → E 211), lat 40..67.2, 0.08°.
  "rtofs-bering": rtofsNest("rtofs-bering", "NOAA RTOFS 1/12° (Bering Sea)", {
    bbox: [155, 40, 211, 67.2],
    dims: { width: 700, height: 340 },
    res: 0.08,
  }),
  // Arctic. lon 160..236 (crosses 180 → E 236), lat 60..80, 0.08°.
  "rtofs-arctic": rtofsNest("rtofs-arctic", "NOAA RTOFS 1/12° (Arctic)", {
    bbox: [160, 60, 236, 80],
    dims: { width: 950, height: 250 },
    res: 0.08,
  }),
  // Hudson Bay / Baffin. DISABLED: native grid is 0.25° (328×152) — coarser than base.
  "rtofs-hudsonbaffin": rtofsNest("rtofs-hudsonbaffin", "NOAA RTOFS 0.25° (Hudson Bay / Baffin)", {
    bbox: [-109, 40, -27, 78], // lon 251..333 → −109..−27
    dims: { width: 328, height: 152 },
    res: 0.25,
    enabled: false,
  }),
  // Hawaii. lon 180..230 → −180..−130, lat 0..40, 0.08°.
  "rtofs-hawaii": rtofsNest("rtofs-hawaii", "NOAA RTOFS 1/12° (Hawaii)", {
    bbox: [-180, 0, -130, 40],
    dims: { width: 625, height: 500 },
    res: 0.08,
  }),
  // W. Pacific / Guam. lon 130..180, lat 0..30, 0.08°.
  "rtofs-guam": rtofsNest("rtofs-guam", "NOAA RTOFS 1/12° (W. Pacific / Guam)", {
    bbox: [130, 0, 180, 30],
    dims: { width: 625, height: 375 },
    res: 0.08,
  }),
  // Samoa (S. Pacific). lon 170..214.8 (crosses 180 → E 214.8), lat −30..0, 0.08°.
  "rtofs-samoa": rtofsNest("rtofs-samoa", "NOAA RTOFS 1/12° (Samoa / S. Pacific)", {
    bbox: [170, -30, 214.8, 0],
    dims: { width: 560, height: 375 },
    res: 0.08,
  }),
  // Tropical Pacific (LOW-RES). NOMADS token `trop_paci_lowres`. DISABLED: a live
  // `wgrib2 -grid` (2026-07) shows a 120×80 grid at 1.0° (lat −40..40, lon 130..250)
  // — coarser than the global 1/12° base, so it would replace finer data with worse.
  "rtofs-troppac": rtofsNest("rtofs-troppac", "NOAA RTOFS 1° (Tropical Pacific, low-res)", {
    bbox: [130, -40, 250, 40], // lon 130..250 (crosses 180)
    dims: { width: 120, height: 80 },
    res: 1.0,
    enabled: false,
  }),
};
