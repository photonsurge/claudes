// weather/waveNests.ts
// Ingest core for the GFS-Wave regional-basin NESTS (Phase 2a): atlocn / epacif /
// wcoast / ecg at 0.16°, published as zoom-gated overlays on top of the global
// `gfswave-mosaic` base. Mirrors `ingestWaveMosaic` in multiSource.ts but keeps
// each basin on its OWN native regional grid + bbox (NO regrid-to-global): per
// basin, per fhr, download the basin GRIB2 → subset to the descriptor bbox/dims
// with wgrib2 -new_grid → regional scalar bake → publishSourceRun tagged with the
// basin's sourceId/resolutionDeg/bbox/priority.
//
// Idempotent (alreadyPublished guard per basin+run), nomadsGate-throttled, temp
// cleaned up in finally. Kept free of process.exit/loadEnv so callers own runtime.

import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { bakeScalar } from "../grib/bakeScalar";
import { regridTileToGlobal } from "../merge/mosaic";
import { latestAvailableRun } from "../sources/gfs";
import {
  waveNestTiles,
  buildWaveNestUrl,
  WAVE_MATCH,
  type WaveNestTile,
} from "../sources/waveNests";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { forecastSteps, cfg } from "./config";
import { getAppDb } from "@photonsurge/shared/db/index";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";

const TAG = "job:weather:source";

export type IngestResult =
  | { published: true; model: string; run: string; runId: string; variables: string[] }
  | { skipped: true; model: string; run: string; reason: string };

const ymdCycleToDate = (date: string, cycle: string): Date =>
  new Date(Date.UTC(
    Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), Number(cycle), 0, 0, 0,
  ));

/**
 * True if a complete published run already exists for this model+run time AND (when
 * `expectGrid` is given) it was baked on the SAME grid we'd produce now. A grid-dims
 * mismatch means the descriptor bbox/dims changed (e.g. an atlocn/wcoast extent fix)
 * → treat the stale run as absent so the corrected grid re-bakes. Mirrors the
 * open-meteo self-heal.
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

/** Ingest ONE wave-basin nest for the given run. */
async function ingestOneNest(tile: WaveNestTile, run: { date: string; cycle: string }, runDate: Date): Promise<IngestResult> {
  const source = getSource(tile.sourceId)!;
  const { width, height } = tile.dims;
  if (await alreadyPublished(source.id, runDate, { width, height })) {
    return { skipped: true, model: source.id, run: runDate.toISOString(), reason: "already published" };
  }
  const { forecastHours, stepHours } = cfg();
  const steps = forecastSteps(forecastHours, stepHours);

  const wave: BakedVariable = {
    meta: {
      encoding: "scalar", units: "m", palette: "wave_height", domain: [0, 12],
      sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority,
    },
    buffers: {},
  };
  const tmp: string[] = [];
  try {
    for (const fhr of steps) {
      let path: string;
      try {
        await nomadsGate();
        path = await downloadToTemp(
          buildWaveNestUrl({ date: run.date, cycle: run.cycle, fhr, grid: tile.grid }),
          `wave.${tile.grid}.f${fhr}.grib2`,
        );
      } catch (err) {
        log(TAG, "wave-nest: download failed", { model: source.id, fhr, grid: tile.grid, err: String(err) });
        continue;
      }
      tmp.push(path);
      try {
        // Subset the basin's native grid to the descriptor bbox/dims (regional —
        // NOT global). regridTileToGlobal runs `wgrib2 -match -new_grid` then dumps
        // the field at the target dims; here the "target" is the basin window.
        const grid = await regridTileToGlobal({
          gribPath: path,
          outPath: `${path}.sub.grib2`,
          match: WAVE_MATCH,
          newgrid: tile.newgrid,
          width,
          height,
        });
        tmp.push(`${path}.sub.grib2`);
        // preRolled: the subset already sits at the basin's own −180..180 window.
        const res = await bakeScalar({ variableId: "wave", values: grid.values, width, height, preRolled: true });
        wave.meta.imageUnscale = res.imageUnscale;
        wave.buffers[fhr] = res.buffer;
      } catch (err) {
        log(TAG, "wave-nest: subset/bake failed", { model: source.id, fhr, grid: tile.grid, err: String(err) });
      }
    }
    if (Object.keys(wave.buffers).length === 0) throw new Error(`no wave steps baked for ${source.id}`);
    const stepMeta = Object.keys(wave.buffers).map(Number).sort((a, b) => a - b)
      .map((fhr) => ({ fhr, validTime: new Date(runDate.getTime() + fhr * 3600 * 1000).toISOString() }));
    const { runId } = await publishSourceRun({
      model: source.id,
      runDate,
      bounds: [...source.bbox],
      grid: { width, height, res: source.resolutionDeg },
      steps: stepMeta,
      variables: { wave },
    });
    return { published: true, model: source.id, run: runDate.toISOString(), runId, variables: ["wave"] };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}

/**
 * Ingest every enabled GFS-Wave regional-basin nest for the latest wave run.
 * Resolves the run once (shared GFS cycle timing), then ingests each basin
 * independently — one basin's failure never blocks the others.
 */
export async function ingestWaveNests(now = new Date()): Promise<IngestResult[]> {
  const run = await latestAvailableRun(now, headOk); // reuse GFS cycle timing
  const runDate = ymdCycleToDate(run.date, run.cycle);
  const results: IngestResult[] = [];
  for (const tile of waveNestTiles()) {
    const source = getSource(tile.sourceId);
    if (!source?.enabled) continue;
    try {
      results.push(await ingestOneNest(tile, run, runDate));
    } catch (err) {
      log(TAG, "wave-nest: ingest failed", { model: tile.sourceId, err: String(err) });
      results.push({ skipped: true, model: tile.sourceId, run: runDate.toISOString(), reason: String(err) });
    }
  }
  return results;
}
