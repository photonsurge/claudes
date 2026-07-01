/**
 * Met Office UKV 2 km (UK) — a regional NEST over the UK + Ireland, sourced from
 * the FREE Met Office AWS Open Data mirror (bucket met-office-atmospheric-model-
 * data, eu-west-2, no credentials / --no-sign-request). NetCDF on the native UKV
 * projection, so the worker regrids to a regular lat-lon subset (like RTOFS's
 * netCDF→grib path) before bake. Only temp + humidity are ingested from the free
 * set. Declares `minZoom`, so `isNestSource` treats it as a nest.
 *
 * Filled + kept consistent (dims·res == bbox) by the UKV adapter. Spread into
 * SOURCE_REGISTRY by sources.ts. The temp/humidity vars exist.
 *
 * VERIFIED from a live listing + NetCDF header (2026-07, run 20260701T0000Z):
 *   - Bucket prefix `uk-deterministic-2km/<YYYYMMDD>T<HHMM>Z/`, files named
 *     `<stamp>-PT<HHHH>H<MM>M-<parameter>.nc`; runs are HOURLY (24/day, nowcast).
 *   - NetCDF header: native grid is Lambert AZIMUTHAL Equal Area (lat_0=54.9,
 *     lon_0=-2.5), 1042×970 pts @ 2000 m — a projected grid (grid: "lambert",
 *     the "needs a regrid" projected family). The worker cdo-remaps it to the
 *     regular lat-lon subset below before baking.
 *   - temp  → NetCDF var `air_temperature` @ 1.5 m (screen level), Kelvin.
 *   - humid → NetCDF var `relative_humidity` @ 1.5 m, a 0..1 FRACTION (×100 → %).
 *
 * Grid identities hold (checked in worker/src/sources/ukv.test.ts):
 *   e = w + (width-1)*res  →  -12 + 944*0.018 = 4.992
 *   n = s + (height-1)*res →   48 + 722*0.018 = 60.996
 * The [-12,48,4.992,60.996] window sits well inside the native LAEA footprint
 * (≈ lon[-24.6,15.4], lat[44.5,63.0]), so the remap has full coverage (0 missing).
 */
import type { SourceDescriptor } from "./sources";

export const UKV_SOURCES: Record<string, SourceDescriptor> = {
  ukv: {
    id: "ukv",
    label: "Met Office UKV 2 km (UK)",
    format: "netcdf",
    // Native grid is Lambert azimuthal equal-area (projected). "lambert" is the
    // closest projected family: only "regular" is drop-in, the rest need a regrid
    // — the worker cdo-remaps to the regular lat-lon target (dims/bbox) below.
    grid: "lambert",
    dims: { width: 945, height: 723 },
    resolutionDeg: 0.018, // ~2 km at UK latitudes
    // Regular lat-lon remap target [W,S,E,N]. MUST equal the cdo remap grid origin/
    // extent AND publishSourceRun bounds. dims·res fills the bbox exactly (above).
    bbox: [-12.0, 48.0, 4.992, 60.996],
    // VERIFY: runs are hourly (nowcast, 24/day) — this cron is the short-run subset
    // the task suggested; every-3h keeps the schedule cheap while the nest is f0-only.
    cadence: { kind: "cron", runsUtc: [0, 3, 6, 9, 12, 15, 18, 21] },
    latencyMinutes: 90,
    variables: ["temp", "humidity"],
    priority: 30, // nest: beats ICON-D2/EU + the GFS/IFS global base inside its bbox
    minZoom: 3.5,
    enabled: true,
    attribution: "© Crown copyright Met Office",
  },
};
