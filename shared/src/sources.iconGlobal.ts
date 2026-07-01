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
  //   width  = 2880 → −180 + 2879·0.125 = 359.875 (wraps to 179.875; e = 180 by
  //            convention — the last cell centre is 179.875, the extent edge 180).
  //   height = 1441 → −90 + 1440·0.125 = 90 = n ✓
  // This EXACTLY matches DWD's `target_grid_world_0125.txt` (−180..180, −90..90 at
  // 0.125°), which the worker remaps onto — so the baked texture's origin/extent
  // equal this bbox and it renders aligned (no stretch).
  "icon-global": {
    id: "icon-global",
    label: "DWD ICON 13 km (global)",
    format: "grib2",
    grid: "icosahedral",
    dims: { width: 2880, height: 1441 },
    resolutionDeg: 0.125,
    bbox: [-180, -90, 180, 90],
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
