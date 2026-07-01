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

/** All RTOFS regional windows share cadence/latency/priority/minZoom/res. */
const RTOFS_REGIONAL_CADENCE = { kind: "cron" as const, runsUtc: [0] }; // one 00z run/day
const RTOFS_REGIONAL_RES = 0.083; // 1/12°
const RTOFS_REGIONAL_PRIORITY = 25; // above global rtofs (20): native window wins in overlap
const RTOFS_REGIONAL_MINZOOM = 3;
const RTOFS_REGIONAL_LATENCY = 8 * 60; // ~8h, same product lag as the global RTOFS base
const RTOFS_REGIONAL_VARS = ["sst", "current", "salinity"]; // VERIFY per-window from a live inventory

/** Pixel dims spanning [W,E]×[S,N] edge-to-edge at ~res° (nx points → span/res+1). */
function dimsFor(bbox: [number, number, number, number], res = RTOFS_REGIONAL_RES) {
  const [w, s, e, n] = bbox;
  return {
    width: Math.round((e - w) / res) + 1,
    height: Math.round((n - s) / res) + 1,
  };
}

function rtofsNest(
  id: string,
  label: string,
  bbox: [number, number, number, number],
  variables: string[] = RTOFS_REGIONAL_VARS,
): SourceDescriptor {
  return {
    id,
    label,
    format: "grib2",
    grid: "regular", // VERIFY: *_std.grb2 regional windows are regular lat-lon
    dims: dimsFor(bbox),
    resolutionDeg: RTOFS_REGIONAL_RES,
    bbox,
    cadence: RTOFS_REGIONAL_CADENCE,
    latencyMinutes: RTOFS_REGIONAL_LATENCY,
    variables,
    priority: RTOFS_REGIONAL_PRIORITY,
    minZoom: RTOFS_REGIONAL_MINZOOM,
    enabled: true,
    attribution: "NOAA/NCEP Global RTOFS",
  };
}

export const RTOFS_REGIONAL_SOURCES: Record<string, SourceDescriptor> = {
  // US East Coast + W. Atlantic. NOMADS token `west_atl`.
  "rtofs-westatl": rtofsNest(
    "rtofs-westatl",
    "NOAA RTOFS 1/12° (US East / W. Atlantic)",
    [-100, 5, -50, 55], // VERIFY: west_atl window [W,S,E,N]
  ),
  // US West Coast (CONUS Pacific). NOMADS token `west_conus`.
  "rtofs-westconus": rtofsNest(
    "rtofs-westconus",
    "NOAA RTOFS 1/12° (US West Coast)",
    [-140, 20, -110, 50], // VERIFY: west_conus window [W,S,E,N]
  ),
  // Alaska (Gulf of Alaska + coastal). NOMADS token `alaska`.
  "rtofs-alaska": rtofsNest(
    "rtofs-alaska",
    "NOAA RTOFS 1/12° (Alaska)",
    [-180, 45, -120, 72], // VERIFY: alaska window [W,S,E,N]
  ),
  // Gulf of Alaska (finer sub-window). NOMADS token `gulf_alaska`.
  "rtofs-gulfalaska": rtofsNest(
    "rtofs-gulfalaska",
    "NOAA RTOFS 1/12° (Gulf of Alaska)",
    [-160, 50, -130, 62], // VERIFY: gulf_alaska window [W,S,E,N]
  ),
  // Bering Sea. NOMADS token `bering`.
  "rtofs-bering": rtofsNest(
    "rtofs-bering",
    "NOAA RTOFS 1/12° (Bering Sea)",
    [-180, 50, -155, 68], // VERIFY: bering window [W,S,E,N]
  ),
  // Arctic. NOMADS token `arctic`.
  "rtofs-arctic": rtofsNest(
    "rtofs-arctic",
    "NOAA RTOFS 1/12° (Arctic)",
    [-180, 65, 180, 90], // VERIFY: arctic window [W,S,E,N]
  ),
  // Hudson Bay / Baffin. NOMADS token `hudson_baffin`.
  "rtofs-hudsonbaffin": rtofsNest(
    "rtofs-hudsonbaffin",
    "NOAA RTOFS 1/12° (Hudson Bay / Baffin)",
    [-100, 50, -50, 80], // VERIFY: hudson_baffin window [W,S,E,N]
  ),
  // Hawaii. NOMADS token `honolulu`.
  "rtofs-hawaii": rtofsNest(
    "rtofs-hawaii",
    "NOAA RTOFS 1/12° (Hawaii)",
    [-170, 15, -150, 30], // VERIFY: honolulu window [W,S,E,N]
  ),
  // W. Pacific / Guam. NOMADS token `guam`.
  "rtofs-guam": rtofsNest(
    "rtofs-guam",
    "NOAA RTOFS 1/12° (W. Pacific / Guam)",
    [130, 5, 155, 25], // VERIFY: guam window [W,S,E,N]
  ),
  // Samoa (S. Pacific). NOMADS token `samoa`.
  "rtofs-samoa": rtofsNest(
    "rtofs-samoa",
    "NOAA RTOFS 1/12° (Samoa / S. Pacific)",
    [-180, -20, -160, -5], // VERIFY: samoa window [W,S,E,N]
  ),
  // Tropical E. Pacific (low-res). NOMADS token `trop_paci_lowres`. VERIFY: the
  // native window spans the dateline (~120°E–70°W); we express the American-side
  // extent here so bbox stays W<E (no antimeridian wrap). If the live extent must
  // cross 180°, split into two descriptors or shift to a 0..360 convention.
  "rtofs-troppac": rtofsNest(
    "rtofs-troppac",
    "NOAA RTOFS 1/12° (Tropical E. Pacific)",
    [-170, -20, -70, 30], // VERIFY: trop_paci_lowres window [W,S,E,N]
  ),
};
