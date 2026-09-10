/**
 * ECCC HRDPS 2.5 km (Canada) — a regional NEST over Canada + the northern US
 * border. Native grid is rotated lat-lon (rotated pole), so the worker
 * wgrib2-regrids it to a regular lat-lon subset (like HRRR's Lambert regrid)
 * before bake. Declares `minZoom`, so `isNestSource` treats it as a nest.
 *
 * Domain VERIFIED against a live continental file (2026-07-01 00Z, TMP_AGL-2m):
 *   `wgrib2 -grid` reports a rotated lat-lon grid 2540×1290 @ 0.0225° with south
 *   pole (−36.089, 245.305). Regridded to regular lat-lon the DEFINED footprint
 *   spans lon ≈ −152.5..−41.0, lat ≈ 27.5..70.5 (measured via -spread over a
 *   0.5° probe grid). The descriptor bbox/dims below snap that footprint onto a
 *   regular grid so it EXACTLY fills the bbox:
 *     res    = 0.045  (2× the native 0.0225°, see below)
 *     W,S    = −153.0, 27.5
 *     width  = 2490 → E = W + (width−1)·res = −40.995
 *     height = 957  → N = S + (height−1)·res = 70.52
 *   i.e. e = w + (width−1)·res and n = s + (height−1)·res hold to the µdegree.
 *   BAKED AT 0.045°, NOT 0.0225° (2026-09-10): at native spacing the regrid was
 *   4979×1913, a 36 MB RGBA texture per variable — and the one synchronous GPU
 *   upload each costs the /watch main thread was a ~350 ms freeze the first
 *   time a run's texture was drawn (docs/watch-perf-plan.md, round 45). 0.045°
 *   is the only coarser step that keeps this bbox exact (4978 and 1912 are
 *   both even; their gcd is 2), and 2490×957 is 9.5 MB. Restore 0.0225 /
 *   4979×1913 here and the worker follows.
 *   The worker's `-new_grid` target origin/extent and publishSourceRun `bounds`
 *   MUST equal this same bbox (they derive it from here).
 *
 * WIND: HRDPS native winds are GRID-relative on the rotated pole (`winds(grid)`),
 * so u/v MUST be regridded TOGETHER in one wgrib2 invocation with
 * `-new_grid_winds earth` to rotate them earth-relative BEFORE bakeVector — the
 * worker ingest does exactly that (a concatenated U+V grib2). Do NOT regrid a
 * lone component (different from the ICON regular-lat-lon case).
 */
import type { SourceDescriptor } from "./sources";

export const HRDPS_SOURCES: Record<string, SourceDescriptor> = {
  hrdps: {
    id: "hrdps",
    label: "ECCC HRDPS 2.5 km (Canada)",
    format: "grib2",
    grid: "rotated",
    // Regular-latlon regrid target: 2490×957 @ 0.045° snapped to the live
    // defined footprint (see file header). dims·res EXACTLY fills the bbox.
    dims: { width: 2490, height: 957 },
    resolutionDeg: 0.045, // baked; the model is 2.5 km (0.0225°) — see header
    // [W, S, E, N]; E = −153 + 2489·0.045 = −40.995, N = 27.5 + 956·0.045 = 70.52.
    bbox: [-153.0, 27.5, -40.995, 70.52],
    cadence: { kind: "cron", runsUtc: [0, 6, 12, 18] },
    latencyMinutes: 90,
    variables: ["temp", "wind", "gust", "humidity", "pressure"],
    priority: 30, // nest: beats the GFS/IFS global base inside its bbox
    minZoom: 3.5,
    enabled: true,
    attribution: "© Environment and Climate Change Canada",
  },
};
