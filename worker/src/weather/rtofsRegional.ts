// weather/rtofsRegional.ts
// Ingest core for the NOAA RTOFS REGIONAL GRIB2 windows (Phase 2e). One zoom-
// gated NEST published PER window on top of the global (regridded netCDF) `rtofs`
// base, so zooming into a coast → sharper ocean sst/current/salinity.
//
// Mirrors ingestRtofs (weather/multiSource.ts) but per-window and from native
// REGIONAL GRIB2 rather than the cdo-remapped global netCDF:
//   1. resolve the latest available RTOFS run (shared cycle timing),
//   2. SKIP any window+run already published (idempotent),
//   3. download the window GRIB2, extract WTMP/UOGRD/VOGRD/PRACTSAL,
//   4. bakeVector (current) + bakeScalar (sst °C, salinity PSU),
//   5. publish via publishSourceRun tagged with the window's source metadata.
//
// A window that omits a variable (or whose bake fails) is skipped rather than
// failing the whole window; a window with no baked variables is skipped whole.
// Kept free of process.exit/loadEnv so callers own the runtime.

import { getAppDb } from "@photonsurge/shared/db/index";
import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { extractField, probeGridGeometry } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakeScalar";
import { bakeVector } from "../grib/bakeVector";
import { wrapLon } from "../regrid/curvilinear";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";
import { type IngestResult } from "./multiSource";
import {
  RTOFS_WINDOWS,
  RTOFS_REGIONAL_VAR_MATCH,
  buildRtofsRegionalUrl,
  rtofsLatestAvailableRun,
} from "../sources/rtofsRegional";

const TAG = "job:weather:source";

/** The real baked-grid geometry for a window, derived from its GRIB2 header. */
export interface RegionalGrid {
  width: number;
  height: number;
  resDeg: number;
  /** [W,S,E,N] in a −180..180-anchored frame; E may exceed 180 when the window
   *  crosses the antimeridian (the periodic globe places it correctly). */
  bounds: [number, number, number, number];
}

/**
 * Turn a probed GRIB2 grid def into the baked-texture geometry: real nx/ny for the
 * reshape (so rows don't shear) and the published bounds. wgrib2 dumps `-order
 * we:ns` (col0 = the grid's first longitude, row0 = north), so we anchor the WEST
 * edge at `wrapLon(lon0)` and extend EAST by the full ascending span — this keeps
 * W < E monotonic even for a window that straddles 180 (E then lands > 180, which
 * the periodic globe renders across the dateline). Pure.
 */
export function regionalGridFromGeometry(geom: {
  nx: number;
  ny: number;
  lat0: number;
  lat1: number;
  lon0: number;
  lon1: number;
  dLon: number;
}): RegionalGrid {
  const latS = Math.min(geom.lat0, geom.lat1);
  const latN = Math.max(geom.lat0, geom.lat1);
  const span = geom.lon1 - geom.lon0; // ascending, positive
  const west = wrapLon(geom.lon0);
  const east = west + span;
  return {
    width: geom.nx,
    height: geom.ny,
    resDeg: geom.dLon,
    bounds: [west, latS, east, latN],
  };
}

/**
 * True if a complete published run already exists for this model+run time AND (when
 * `expectGrid` is given) it was baked on the SAME grid we'd produce now. A grid-dims
 * mismatch means the run is stale — e.g. baked with the descriptor's guessed dims before
 * the probe-geometry logic, which leaves the served texture striped/wrong — so we treat it
 * as absent and re-bake on the real probed grid. Mirrors the open-meteo / wave-nest self-heal.
 */
async function alreadyPublished(
  model: string,
  runDate: Date,
  expectGrid?: { width: number; height: number },
): Promise<boolean> {
  const db = await getAppDb();
  const existing = await db.weatherRuns.getByQuery({ model, run: runDate, status: "complete", published: true });
  if (!(existing.success && existing.data)) return false;
  if (expectGrid) {
    const g = (existing.data as { grid?: { width?: number; height?: number } }).grid;
    if (g?.width !== expectGrid.width || g?.height !== expectGrid.height) return false;
  }
  return true;
}

/** Bake one window's variables and publish, or return a skip. */
async function ingestWindow(
  win: (typeof RTOFS_WINDOWS)[number],
  run: { date: string; runDate: Date },
): Promise<IngestResult> {
  const source = getSource(win.sourceId)!;
  // NOTE: the published-guard is checked AFTER probing the real grid below (not here), so a
  // stale run baked on the wrong (descriptor-guessed) dims is detected and re-baked. That
  // costs one download per already-current window per run — acceptable for a daily product.

  const variables: Record<string, BakedVariable> = {};
  const tmp: string[] = [];
  try {
    await nomadsGate();
    let gribPath: string;
    try {
      gribPath = await downloadToTemp(
        buildRtofsRegionalUrl({ date: run.date, token: win.token }),
        `rtofs.${win.token}.grib2`,
      );
    } catch (err) {
      log(TAG, "rtofs-regional: download failed", { window: win.sourceId, err: String(err) });
      return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "download failed" };
    }
    tmp.push(gribPath);

    // Read the TRUE grid geometry from the file — never trust the descriptor's
    // guessed dims/bbox (a wrong nx shears every row → horizontal striping). Probe
    // once from a representative record all steps share.
    const probeMatch =
      RTOFS_REGIONAL_VAR_MATCH[win.variables.find((v) => RTOFS_REGIONAL_VAR_MATCH[v]) ?? "sst"]
        ?.match[0] ?? ":WTMP:";
    let grid: ReturnType<typeof regionalGridFromGeometry>;
    try {
      grid = regionalGridFromGeometry(await probeGridGeometry({ gribPath, match: probeMatch }));
    } catch (err) {
      log(TAG, "rtofs-regional: grid probe failed", { window: win.sourceId, err: String(err) });
      return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "grid probe failed" };
    }
    const W = grid.width;
    const H = grid.height;

    // Skip only if an existing run was baked on THIS real grid; a stale run on the old
    // guessed dims (→ striped texture) has different dims and re-bakes.
    if (await alreadyPublished(source.id, run.runDate, { width: W, height: H })) {
      return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
    }

    const field = async (match: string) =>
      (await extractField({ gribPath, match, width: W, height: H })).values;

    for (const variableId of win.variables) {
      const spec = RTOFS_REGIONAL_VAR_MATCH[variableId];
      if (!spec) continue; // window declares a variable we have no match token for
      try {
        if (spec.encoding === "uv") {
          const u = await field(spec.match[0]);
          const v = await field(spec.match[1]);
          const res = await bakeVector({ variableId, u, v, width: W, height: H, preRolled: true });
          variables[variableId] = {
            meta: {
              encoding: "uv",
              units: "m/s",
              domain: res.domain,
              palette: "current",
              imageUnscale: res.imageUnscale,
              vectorUnscale: res.imageUnscale,
              sourceId: source.id,
              resolutionDeg: grid.resDeg,
              bbox: grid.bounds,
              priority: source.priority,
            },
            buffers: { 0: res.buffer },
          };
        } else {
          const values = await field(spec.match[0]);
          // Native regional windows carry WTMP in KELVIN (unlike the cdo global
          // product) → let bakeScalar do K→°C for sst; salinity is already PSU so
          // skip the unit convert for it. VERIFY the native unit from a live header.
          const skipUnitConvert = variableId !== "sst";
          const res = await bakeScalar({ variableId, values, width: W, height: H, preRolled: true, skipUnitConvert });
          variables[variableId] = {
            meta: {
              encoding: "scalar",
              units: variableId === "sst" ? "°C" : "PSU",
              domain: res.domain,
              palette: variableId,
              imageUnscale: res.imageUnscale,
              sourceId: source.id,
              resolutionDeg: grid.resDeg,
              bbox: grid.bounds,
              priority: source.priority,
            },
            buffers: { 0: res.buffer },
          };
        }
      } catch (err) {
        log(TAG, "rtofs-regional: bake failed", { window: win.sourceId, variableId, err: String(err) });
      }
    }

    if (Object.keys(variables).length === 0) {
      return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "no variables baked" };
    }

    const { runId } = await publishSourceRun({
      model: source.id,
      runDate: run.runDate,
      bounds: [...grid.bounds],
      grid: { width: W, height: H, res: grid.resDeg },
      steps: [{ fhr: 0, validTime: run.runDate.toISOString() }],
      variables,
    });
    return { published: true, model: source.id, run: run.runDate.toISOString(), runId, variables: Object.keys(variables) };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}

/**
 * Ingest EVERY RTOFS regional window for the latest available run. Each window is
 * independent: a download/bake failure or an already-published guard skips just
 * that window, never the batch. Returns one IngestResult per window.
 */
export async function ingestRtofsRegional(now = new Date()): Promise<IngestResult[]> {
  const run = await rtofsLatestAvailableRun(now, headOk);
  const results: IngestResult[] = [];
  for (const win of RTOFS_WINDOWS) {
    // Honour the descriptor's `enabled` flag: a window can be disabled in the
    // registry (e.g. rtofs-troppac — a 1° dateline-crossing lowres oddity that
    // isn't a valid finer nest) without dropping it from RTOFS_WINDOWS (findWindow
    // still needs the lookup).
    if (getSource(win.sourceId)?.enabled === false) continue;
    try {
      results.push(await ingestWindow(win, run));
    } catch (err) {
      log(TAG, "rtofs-regional: window failed", { window: win.sourceId, err: String(err) });
      results.push({ skipped: true, model: win.sourceId, run: run.runDate.toISOString(), reason: `error: ${String(err)}` });
    }
  }
  return results;
}
