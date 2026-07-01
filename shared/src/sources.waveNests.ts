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
const WAVE_NEST_RES = 0.16;
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
): SourceDescriptor {
  return {
    id,
    label,
    format: "grib2",
    grid: "regular",
    dims: dimsFor(bbox),
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
  // N. Atlantic basin. VERIFY: gfswave.tCCz.atlocn.0p16 extent ≈ 98°W–10°E, 0–65°N.
  "gfswave-atlocn": waveNest(
    "gfswave-atlocn",
    "NOAA GFS-Wave 0.16° (N. Atlantic)",
    [-98, 0, 10, 65], // VERIFY: atlocn grid [W,S,E,N]
  ),
  // E. Pacific basin. VERIFY: gfswave.tCCz.epacif.0p16 extent ≈ 170°E–77°W, 20°S–66°N.
  "gfswave-epacif": waveNest(
    "gfswave-epacif",
    "NOAA GFS-Wave 0.16° (E. Pacific)",
    [-170, -20, -77, 66], // VERIFY: epacif grid [W,S,E,N]
  ),
  // US West Coast. VERIFY: gfswave.tCCz.wcoast.0p16 extent ≈ 165°W–116°W, 25°N–50°N.
  "gfswave-wcoast": waveNest(
    "gfswave-wcoast",
    "NOAA GFS-Wave 0.16° (US West Coast)",
    [-165, 25, -116, 50], // VERIFY: wcoast grid [W,S,E,N]
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
