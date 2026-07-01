// weather/multiSource.ts
// Reusable ingest cores for the extra suppliers (IFS, RTOFS, GFS-Wave mosaic),
// shared by the manual `refresh:*` scripts AND the scheduled BullMQ jobs. Each:
//   1. resolves the latest available run,
//   2. SKIPS if that model+run is already published (idempotent — repeat ticks
//      don't re-bake or re-hammer the upstream),
//   3. bakes + publishes via publishSourceRun (tagged per-model run).
// Kept free of process.exit/loadEnv so callers own the runtime.

import { getAppDb } from "@photonsurge/shared/db/index";
import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { GFS_GRID, GFS_BOUNDS } from "../grib/bake";
import { extractField, runWgrib2 } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakeScalar";
import { bakeWind } from "../grib/bakeWind";
import { bakeVector } from "../grib/bakeVector";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { forecastSteps, cfg } from "./config";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";
import { netcdfToGrib2 } from "../netcdf/toGrib2";
import { buildIfsUrl, ifsLatestAvailableRun, ifsForecastSteps, IFS_VAR_MATCH } from "../sources/ifs";
import { latestAvailableRun } from "../sources/gfs";
import { WAVE_TILES, WAVE_MATCH, WAVE_MOSAIC_GRID, WAVE_MOSAIC_NEWGRID, buildWaveTileUrl } from "../sources/gfswave";
import { regridTileToGlobal, mosaicByPriority, type MosaicTile } from "../merge/mosaic";
import {
  buildRtofsUrl, rtofsLatestAvailableRun,
  RTOFS_VARS, RTOFS_TARGET_GRID, RTOFS_TARGET_BOUNDS, RTOFS_CDO_REMAP_GRID,
} from "../sources/rtofs";

const TAG = "job:weather:source";

export type IngestResult =
  | { published: true; model: string; run: string; runId: string; variables: string[] }
  | { skipped: true; model: string; run: string; reason: string };

const ymdCycleToDate = (date: string, cycle: string): Date =>
  new Date(Date.UTC(
    Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), Number(cycle), 0, 0, 0,
  ));

/** True if a complete published run already exists for this model+run time. */
async function alreadyPublished(model: string, runDate: Date): Promise<boolean> {
  const db = await getAppDb();
  const existing = await db.weatherRuns.getByQuery({ model, run: runDate, status: "complete", published: true });
  return !!(existing.success && existing.data);
}

// ── ECMWF IFS ────────────────────────────────────────────────────────────────
export async function ingestIfs(now = new Date()): Promise<IngestResult> {
  const source = getSource("ifs")!;
  const run = await ifsLatestAvailableRun(now, headOk);
  const runDate = ymdCycleToDate(run.date, run.cycle);
  if (await alreadyPublished(source.id, runDate)) {
    return { skipped: true, model: source.id, run: runDate.toISOString(), reason: "already published" };
  }
  const { forecastHours, stepHours } = cfg();
  const allowed = new Set(ifsForecastSteps(run.cycle));
  const steps = forecastSteps(forecastHours, stepHours).filter((h) => allowed.has(h));

  const variables: Record<string, BakedVariable> = {};
  const tag = (id: string, meta: BakedVariable["meta"]) => (variables[id] ??= { meta, buffers: {} });
  const tmp: string[] = [];
  const G = { width: GFS_GRID.width, height: GFS_GRID.height };
  try {
    for (const fhr of steps) {
      let path: string;
      try {
        path = await downloadToTemp(buildIfsUrl({ date: run.date, cycle: run.cycle, step: fhr }), `ifs.f${fhr}.grib2`);
      } catch (err) {
        log(TAG, "ifs: download failed", { fhr, err: String(err) });
        continue;
      }
      tmp.push(path);
      for (const [variableId, matches] of Object.entries(IFS_VAR_MATCH)) {
        try {
          if (variableId === "wind") {
            const u = await extractField({ gribPath: path, match: matches[0], ...G });
            const v = await extractField({ gribPath: path, match: matches[1], ...G });
            const res = await bakeWind({ u: u.values, v: v.values, width: G.width, height: G.height });
            tag("wind", { encoding: "uv", units: "m/s", domain: res.domain, palette: "wind", imageUnscale: res.imageUnscale, vectorUnscale: res.imageUnscale, sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority }).buffers[fhr] = res.buffer;
          } else {
            const f = await extractField({ gribPath: path, match: matches[0], ...G });
            const res = await bakeScalar({ variableId, values: f.values, width: G.width, height: G.height });
            tag(variableId, { encoding: "scalar", units: variableId === "temp" ? "°C" : "hPa", domain: res.domain, palette: variableId, imageUnscale: res.imageUnscale, sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority }).buffers[fhr] = res.buffer;
          }
        } catch (err) {
          log(TAG, "ifs: bake failed", { fhr, variableId, err: String(err) });
        }
      }
    }
    if (Object.keys(variables).length === 0) throw new Error("no IFS variables baked (CCSDS wgrib2? endpoint drift?)");
    const stepMeta = steps.map((fhr) => ({ fhr, validTime: new Date(runDate.getTime() + fhr * 3600 * 1000).toISOString() }));
    const { runId } = await publishSourceRun({ model: source.id, runDate, bounds: [...GFS_BOUNDS], grid: { ...GFS_GRID }, steps: stepMeta, variables });
    return { published: true, model: source.id, run: runDate.toISOString(), runId, variables: Object.keys(variables) };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}

// ── NOAA RTOFS ocean (netCDF → cdo → GRIB2 → bake) ────────────────────────────
export async function ingestRtofs(now = new Date()): Promise<IngestResult> {
  const source = getSource("rtofs")!;
  const run = await rtofsLatestAvailableRun(now, headOk);
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }
  const W = RTOFS_TARGET_GRID.width;
  const H = RTOFS_TARGET_GRID.height;
  const variables: Record<string, BakedVariable> = {};
  const tmp: string[] = [];
  try {
    await nomadsGate();
    const ncPath = await downloadToTemp(buildRtofsUrl({ date: run.date, hour: 24, kind: "n", bundle: "prog" }), "rtofs.prog.nc");
    tmp.push(ncPath);
    const gribPath = `${ncPath}.grb2`;
    await netcdfToGrib2({ inPath: ncPath, outPath: gribPath, remapGrid: RTOFS_CDO_REMAP_GRID });
    tmp.push(gribPath);
    const field = async (match: string) => (await extractField({ gribPath, match, width: W, height: H })).values;
    for (const [variableId, spec] of Object.entries(RTOFS_VARS)) {
      try {
        if (spec.encoding === "uv") {
          const u = await field(spec.gribMatch[0]);
          const v = await field(spec.gribMatch[1]);
          const res = await bakeVector({ variableId, u, v, width: W, height: H, preRolled: true });
          variables[variableId] = { meta: { encoding: "uv", units: "m/s", domain: res.domain, palette: "current", imageUnscale: res.imageUnscale, vectorUnscale: res.imageUnscale, sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority }, buffers: { 0: res.buffer } };
        } else {
          const values = await field(spec.gribMatch[0]);
          const res = await bakeScalar({ variableId, values, width: W, height: H, preRolled: true, skipUnitConvert: spec.displayUnits });
          variables[variableId] = { meta: { encoding: "scalar", units: variableId === "sst" ? "°C" : "PSU", domain: res.domain, palette: variableId, imageUnscale: res.imageUnscale, sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority }, buffers: { 0: res.buffer } };
        }
      } catch (err) {
        log(TAG, "rtofs: bake failed", { variableId, err: String(err) });
      }
    }
    if (Object.keys(variables).length === 0) throw new Error("no RTOFS variables baked (cdo installed? GRIB2 tokens correct?)");
    const { runId } = await publishSourceRun({ model: source.id, runDate: run.runDate, bounds: [...RTOFS_TARGET_BOUNDS], grid: { width: W, height: H, res: RTOFS_TARGET_GRID.res }, steps: [{ fhr: 0, validTime: run.runDate.toISOString() }], variables });
    return { published: true, model: source.id, run: run.runDate.toISOString(), runId, variables: Object.keys(variables) };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}

// ── GFS-Wave regional mosaic ──────────────────────────────────────────────────
export async function ingestWaveMosaic(now = new Date()): Promise<IngestResult> {
  const source = getSource("gfswave-mosaic")!;
  const run = await latestAvailableRun(now, headOk); // reuse GFS cycle timing
  const runDate = ymdCycleToDate(run.date, run.cycle);
  if (await alreadyPublished(source.id, runDate)) {
    return { skipped: true, model: source.id, run: runDate.toISOString(), reason: "already published" };
  }
  const { forecastHours, stepHours } = cfg();
  const steps = forecastSteps(forecastHours, stepHours);
  const N = WAVE_MOSAIC_GRID.width * WAVE_MOSAIC_GRID.height;
  const wave: BakedVariable = {
    meta: { encoding: "scalar", units: "m", palette: "wave_height", domain: [0, 12], sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority },
    buffers: {},
  };
  const tmp: string[] = [];
  try {
    for (const fhr of steps) {
      const tiles: MosaicTile[] = [];
      for (const tile of WAVE_TILES) {
        let path: string;
        try {
          await nomadsGate();
          path = await downloadToTemp(buildWaveTileUrl({ date: run.date, cycle: run.cycle, fhr, grid: tile.grid }), `wave.${tile.grid}.f${fhr}.grib2`);
        } catch (err) {
          log(TAG, "wave: download failed", { fhr, tile: tile.grid, err: String(err) });
          continue;
        }
        tmp.push(path);
        try {
          const grid = await regridTileToGlobal({ gribPath: path, outPath: `${path}.rg.grib2`, match: WAVE_MATCH, newgrid: WAVE_MOSAIC_NEWGRID, width: WAVE_MOSAIC_GRID.width, height: WAVE_MOSAIC_GRID.height });
          tmp.push(`${path}.rg.grib2`);
          tiles.push({ values: grid.values, priority: tile.priority });
        } catch (err) {
          log(TAG, "wave: regrid failed", { fhr, tile: tile.grid, err: String(err) });
        }
      }
      if (!tiles.length) continue;
      const composited = mosaicByPriority(tiles, N);
      const res = await bakeScalar({ variableId: "wave", values: composited, width: WAVE_MOSAIC_GRID.width, height: WAVE_MOSAIC_GRID.height, preRolled: true });
      wave.meta.imageUnscale = res.imageUnscale;
      wave.buffers[fhr] = res.buffer;
    }
    if (Object.keys(wave.buffers).length === 0) throw new Error("no wave steps mosaicked");
    const stepMeta = Object.keys(wave.buffers).map(Number).sort((a, b) => a - b).map((fhr) => ({ fhr, validTime: new Date(runDate.getTime() + fhr * 3600 * 1000).toISOString() }));
    const { runId } = await publishSourceRun({ model: source.id, runDate, bounds: [-180, -90, 180, 90], grid: { width: WAVE_MOSAIC_GRID.width, height: WAVE_MOSAIC_GRID.height, res: WAVE_MOSAIC_GRID.res }, steps: stepMeta, variables: { wave } });
    return { published: true, model: source.id, run: runDate.toISOString(), runId, variables: ["wave"] };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}

/** Print cdo's GRIB2 inventory for the latest RTOFS file — a token-diagnostics aid. */
export async function rtofsInventory(gribPath: string): Promise<string[]> {
  const inv = (await runWgrib2([gribPath])).toString();
  return inv.split("\n").filter(Boolean);
}
