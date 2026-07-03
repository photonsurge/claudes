/**
 * Wave-basin regional NEST sources (Phase 2a). These are the finer-than-global
 * GFS-Wave regional grids (atlocn/epacif/wcoast/ecg 0.16°) published as
 * zoom-gated overlays on top of the global `gfswave-mosaic` base. Each declares
 * `minZoom`, so `isNestSource` treats it as a nest, and the client shows it only
 * when the camera zooms into its `bbox`.
 *
 * Spread into `SOURCE_REGISTRY` by `sources.ts`. Kept in its own file so the wave
 * adapter can own its descriptors without contending on `sources.ts`.
 *
 * The `wave` variable already exists in `variables.ts`; these only add suppliers.
 *
 * NOTE (design): unlike `gfswave-mosaic` (which regrids several tiles onto ONE
 * common global 1/6° grid and composites), each nest keeps its OWN native
 * regional 0.16° grid + bbox — no regrid-to-global. The worker subsets the basin
 * GRIB2 to the descriptor bbox/dims and bakes it as a regional texture; the
 * client stacks it over the mosaic by `priority` inside `bbox`.
 *
 * Priority ladder for `wave`: gfswave-0p25 (10) < gfswave-mosaic (20) <
 * these basin nests (25) — the native basin tile wins where it overlaps the
 * mosaic, and the mosaic still fills everywhere the basins don't cover.
 *
 * VERIFY (against live NOMADS `wave/gridded/` GRIB2 headers): the exact grid
 * extents below are the published GFS-Wave regional-grid definitions. Confirm
 * each `bbox` (and that the 0p16 file exists for the basin) from a live run — the
 * `dims` are derived from bbox/res so they follow whatever the verified bbox is.
 */
import type { SourceDescriptor } from "./sources";

/** Basin nests all share cadence/latency/priority/minZoom — build them uniformly. */
const WAVE_NEST_CADENCE = { kind: "cron" as const, runsUtc: [0, 6, 12, 18] };
// GFS-Wave regional basins are on a 1/6° grid (0.166667°), NOT 0.16° — verified
// from live NOMADS GRIB2 headers (`by 0.166667`). Using 0.16 mis-sized the dims.
const WAVE_NEST_RES = 1 / 6;
const WAVE_NEST_PRIORITY = 25; // above gfswave-mosaic (20): native basin wins in overlap
const WAVE_NEST_MINZOOM = 3.5;
const WAVE_NEST_LATENCY = 240; // ~4h, same product lag as the global wave base

/** Pixel dims spanning [W,E]×[S,N] edge-to-edge at ~res° (nx points → span/res+1). */
function dimsFor(bbox: [number, number, number, number], res = WAVE_NEST_RES) {
  const [w, s, e, n] = bbox;
  return {
    width: Math.round((e - w) / res) + 1,
    height: Math.round((n - s) / res) + 1,
  };
}

function waveNest(
  id: string,
  label: string,
  bbox: [number, number, number, number],
  dims: { width: number; height: number } = dimsFor(bbox),
): SourceDescriptor {
  return {
    id,
    label,
    format: "grib2",
    grid: "regular",
    dims,
    resolutionDeg: WAVE_NEST_RES,
    bbox,
    cadence: WAVE_NEST_CADENCE,
    latencyMinutes: WAVE_NEST_LATENCY,
    variables: ["wave"],
    priority: WAVE_NEST_PRIORITY,
    minZoom: WAVE_NEST_MINZOOM,
    enabled: true,
    attribution: "NOAA/NCEP GFS-Wave",
  };
}

export const WAVE_NEST_SOURCES: Record<string, SourceDescriptor> = {
  // N. Atlantic basin. VERIFIED against live GRIB2 header (gfs.20260702/12):
  // 301×331, lat 55→0, lon 260→310 (0..360) = −100..−50 in −180..180.
  "gfswave-atlocn": waveNest(
    "gfswave-atlocn",
    "NOAA GFS-Wave 0.16° (N. Atlantic)",
    [-100, 0, -50, 55], // atlocn.0p16 grid [W,S,E,N]
    { width: 301, height: 331 },
  ),
  // E. Pacific basin. VERIFIED header: 511×301, lat 30→−20, lon 130→215 — i.e.
  // 130°E → 155°W, which CROSSES THE ANTIMERIDIAN. A plain W<E lat-lon window can't
  // express it and the wgrib2 subset/bake + client bbox both assume −180..180 with
  // W<E, so this basin is DISABLED until dateline-aware subsetting is added. The
  // global gfswave-mosaic still covers the central Pacific meanwhile.
  "gfswave-epacif": {
    ...waveNest(
      "gfswave-epacif",
      "NOAA GFS-Wave 0.16° (E. Pacific)",
      [130, -20, 215, 30], // real extent (0..360 lon), antimeridian-crossing
      { width: 511, height: 301 },
    ),
    enabled: false,
  },
  // US West Coast. VERIFIED header: 241×151, lat 50→25, lon 210→250 = −150..−110.
  "gfswave-wcoast": waveNest(
    "gfswave-wcoast",
    "NOAA GFS-Wave 0.16° (US West Coast)",
    [-150, 25, -110, 50], // wcoast.0p16 grid [W,S,E,N]
    { width: 241, height: 151 },
  ),
  // US East Coast + Gulf of Mexico. DISABLED: NOAA does NOT publish an `ecg` grid
  // at 0.16° — a live `wave/gridded/` listing (2026-07) carries only atlocn /
  // epacif / wcoast / global at 0p16, so this 404s every run. The `atlocn` basin
  // (−98..10°E, 0..65°N) already covers the US East Coast + Gulf, making a separate
  // ecg nest redundant. Re-enable only if NOAA ships a distinct ecg 0p16 grid.
  "gfswave-ecg": {
    ...waveNest(
      "gfswave-ecg",
      "NOAA GFS-Wave 0.16° (US East Coast/Gulf)",
      [-100, 0, -50, 55],
    ),
    enabled: false,
  },
};
