// weather/ukv.ts
// Ingest core for the Met Office UKV 2 km (UK) regional nest, from the FREE Met
// Office AWS Open Data mirror. Mirrors ingestRtofs (netCDF → cdo remap → GRIB2 →
// wgrib2 extract → bake) but per-UK-window and from the public S3 mirror:
//   1. resolve the latest available hourly run (probe the f0 temp file),
//   2. SKIP if that model+run is already published (idempotent),
//   3. download the UKV f0 NetCDF for temp + humidity,
//   4. cdo -remapbil the native Lambert-azimuthal grid → a regular lat-lon subset
//      over the UKV bbox (dims/res from the descriptor),
//   5. bakeScalar temp (K→°C) + humidity (0..1 fraction → % , then skipUnitConvert),
//   6. publish via publishSourceRun tagged with the descriptor's source meta.
//
// Worker-only: downloads NetCDF, bakes textures, stores them in Mongo. Kept free
// of process.exit/loadEnv so callers (manual refresh script or a BullMQ job) own
// the runtime. Handler name suggestion: `refreshUkv`.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAppDb } from "@photonsurge/shared/db/index";
import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { extractField } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakePool";
import { netcdfToGrib2 } from "../netcdf/toGrib2";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";
import { type IngestResult } from "./multiSource";
import {
  buildUkvUrl,
  ukvLatestAvailableRun,
  UKV_PARAMS,
  UKV_REMAP_GRID,
  UKV_GRID,
  type UkvRun,
} from "../sources/ukv";

const TAG = "job:weather:source";

/** True if a complete published run already exists for this model+run time. */
async function alreadyPublished(model: string, runDate: Date): Promise<boolean> {
  const db = await getAppDb();
  const existing = await db.weatherRuns.getByQuery({ model, run: runDate, status: "complete", published: true });
  return !!(existing.success && existing.data);
}

/** Scale a scalar grid in place on a new Float32Array (for RH fraction → %). */
function scale(values: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] * factor;
  return out;
}

/**
 * Ingest the latest UKV run's analysis (f0) into a published WeatherRun.
 * Idempotent (skips an already-published run) and cleans every temp file in
 * `finally`. f0 only to start (the descriptor declares a single {fhr:0} step).
 */
export async function ingestUkv(now = new Date()): Promise<IngestResult> {
  const source = getSource("ukv")!;
  const run: UkvRun = await ukvLatestAvailableRun(now, headOk);
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }

  const W = UKV_GRID.width;
  const H = UKV_GRID.height;
  const variables: Record<string, BakedVariable> = {};
  const tmp: string[] = [];
  const track = (p: string) => { tmp.push(p); return p; };

  try {
    // Write the cdo remap grid-description to a temp file cdo can read by path.
    const gridDir = await mkdtemp(join(tmpdir(), "ukvgrid-"));
    const gridPath = track(join(gridDir, "ukv.grid"));
    await writeFile(gridPath, UKV_REMAP_GRID);

    for (const [variableId, spec] of Object.entries(UKV_PARAMS)) {
      // Only ingest variables the descriptor declares.
      if (!source.variables.includes(variableId)) continue;
      try {
        const ncPath = track(await downloadToTemp(
          buildUkvUrl({ runDate: run.runDate, variableId, leadMinutes: 0 }),
          `ukv.${variableId}.nc`,
        ));
        // cdo: remap the native Lambert-azimuthal grid → regular lat-lon subset.
        const gribPath = track(`${ncPath}.grb2`);
        await netcdfToGrib2({ inPath: ncPath, outPath: gribPath, remapGrid: gridPath, selnames: [spec.ncVar] });

        const field = await extractField({ gribPath, match: spec.match, width: W, height: H });
        // UKV humidity is a 0..1 FRACTION → ×100 to %; then skip the K→°C convert
        // (which would otherwise leave the identity RH untouched anyway). temp is
        // Kelvin → let bakeScalar do the standard K→°C conversion.
        const values = variableId === "humidity" ? scale(field.values, 100) : field.values;
        const res = await bakeScalar({
          variableId,
          values,
          width: W,
          height: H,
          preRolled: true,          // already a regular −180..180 subset (no roll)
          skipUnitConvert: variableId === "humidity",
        });
        variables[variableId] = {
          meta: {
            encoding: "scalar",
            units: variableId === "temp" ? "°C" : "%",
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
      } catch (err) {
        log(TAG, "ukv: bake failed", { variableId, err: String(err) });
      }
    }

    if (Object.keys(variables).length === 0) {
      throw new Error("no UKV variables baked (cdo installed? NetCDF var names / S3 key drift?)");
    }

    const validTime = run.runDate.toISOString();
    const { runId } = await publishSourceRun({
      model: source.id,
      runDate: run.runDate,
      bounds: [...source.bbox],
      grid: { width: W, height: H, res: source.resolutionDeg },
      steps: [{ fhr: 0, validTime }],
      variables,
    });
    return { published: true, model: source.id, run: run.runDate.toISOString(), runId, variables: Object.keys(variables) };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}
