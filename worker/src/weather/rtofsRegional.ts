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

import { extractField } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakeScalar";
import { bakeVector } from "../grib/bakeVector";
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

/** True if a complete published run already exists for this model+run time. */
async function alreadyPublished(model: string, runDate: Date): Promise<boolean> {
  const db = await getAppDb();
  const existing = await db.weatherRuns.getByQuery({ model, run: runDate, status: "complete", published: true });
  return !!(existing.success && existing.data);
}

/** Bake one window's variables and publish, or return a skip. */
async function ingestWindow(
  win: (typeof RTOFS_WINDOWS)[number],
  run: { date: string; runDate: Date },
): Promise<IngestResult> {
  const source = getSource(win.sourceId)!;
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }

  const W = win.dims.width;
  const H = win.dims.height;
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
              resolutionDeg: source.resolutionDeg,
              bbox: source.bbox,
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
              resolutionDeg: source.resolutionDeg,
              bbox: source.bbox,
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
      bounds: [...source.bbox],
      grid: { width: W, height: H, res: source.resolutionDeg },
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
