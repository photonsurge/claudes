/**
 * DWD ICON global 13 km — a WORLDWIDE nest (bbox = whole globe) that overlays the
 * GFS base everywhere once you zoom in, giving ~2× finer resolution over the
 * entire planet (Australia, Russia, China, Japan, oceans — everywhere no regional
 * box covers). Declares `minZoom`, so `isNestSource` treats it as a nest; low
 * priority so any tighter regional box (HRRR/ICON-D2/…) still wins in its bbox.
 *
 * Filled + kept consistent (dims·res == bbox) by the ICON-global adapter. Spread
 * into SOURCE_REGISTRY by sources.ts. The temp/wind/gust/humidity vars exist.
 */
import type { SourceDescriptor } from "./sources";

export const ICON_GLOBAL_SOURCES: Record<string, SourceDescriptor> = {
  // DWD ICON global 13 km — the "everywhere" bump. A WORLDWIDE nest (bbox = whole
  // globe) that overlays the GFS/IFS base at ~2× resolution everywhere once you
  // zoom in (Australia, Russia, China, Japan, all oceans — everywhere no regional
  // box covers). Native grid is the ICOSAHEDRAL triangular mesh; the worker
  // remaps it to a regular 0.125° global lat-lon grid (cdo remap with DWD's
  // precomputed weights) before baking.
  //
  // GRID CONSISTENCY (must satisfy e = w+(width-1)·res, n = s+(height-1)·res):
  //   width  = 2879 → −180 + 2878·0.125 = 179.75 = e (last cell centre = extent).
  //   height = 1441 → −90 + 1440·0.125 = 90 = n ✓
  // These are VERIFIED against DWD's `target_grid_world_0125.txt` (which the worker
  // remaps onto): gridtype=lonlat, xsize=2879, ysize=1441, xfirst=−180, xinc=0.125,
  // yfirst=−90, yinc=0.125. NOTE the grid is 2879 (not 2880) wide — it stops at the
  // 179.75 cell centre, leaving a 0.25° gap at the antimeridian (DWD's grid, not
  // ours). dims MUST equal the remap output exactly or wgrib2 short-outputs the
  // extract and every field fails to bake.
  "icon-global": {
    id: "icon-global",
    label: "DWD ICON 13 km (global)",
    format: "grib2",
    grid: "icosahedral",
    dims: { width: 2879, height: 1441 },
    resolutionDeg: 0.125,
    bbox: [-180, -90, 179.75, 90],
    cadence: { kind: "cron", runsUtc: [0, 6, 12, 18] },
    latencyMinutes: 240, // ~4h to publish the run; poll rather than trust
    variables: ["temp", "wind", "gust", "humidity"],
    // LOW nest priority: any tighter regional nest (HRRR 30, ICON-D2 30, ICON-EU
    // 28, UKV/HRDPS, wave/ocean nests) still wins inside its bbox; icon-global
    // only fills the everywhere-else gap above the global base.
    priority: 12,
    // Activates as soon as you zoom in — everywhere. Low floor so the finer
    // global field attaches globally the moment the camera leaves the far-out
    // whole-disc view.
    minZoom: 2,
    enabled: true,
    attribution: "© Deutscher Wetterdienst (DWD)",
  },
};
