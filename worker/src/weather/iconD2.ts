// weather/iconD2.ts
// Ingest core for the DWD ICON-D2 (Europe) regional NEST. Worker-only: download
// the bzip2-compressed regular-lat-lon GRIB2 (one file per DWD field per step),
// bunzip2 → wgrib2-resample onto the descriptor's exact regular grid over the
// icon-d2 bbox → bake (scalar for temp/gust, uv vector for wind) → publish a
// per-model run tagged as a nest (sourceId/resolutionDeg/bbox/priority).
//
// Mirrors ingestRtofs/ingestIfs in multiSource.ts: idempotent (skip if the run
// is already published), throttled (nomadsGate), temp cleanup in finally.

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";

import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { extractField } from "../grib/wgrib2";
import { runWgrib2 } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakeScalar";
import { bakeVector } from "../grib/bakeVector";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { getAppDb } from "@photonsurge/shared/db/index";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";
import {
  buildIconD2Url,
  iconD2LatestAvailableRun,
  ICON_D2_VAR_TOKENS,
  ICON_D2_FIELD_MATCH,
  padIconD2Step,
} from "../sources/iconD2";

const TAG = "job:weather:source";

export type IngestResult =
  | { published: true; model: string; run: string; runId: string; variables: string[] }
  | { skipped: true; model: string; run: string; reason: string };

/** True if a complete published run already exists for this model+run time. */
async function alreadyPublished(model: string, runDate: Date): Promise<boolean> {
  const db = await getAppDb();
  const existing = await db.weatherRuns.getByQuery({ model, run: runDate, status: "complete", published: true });
  return !!(existing.success && existing.data);
}

/**
 * Decompress a `.bz2` file to `outPath` by shelling out to `bunzip2` (streamed,
 * keeps the original). Node has no built-in bzip2, so this is the minimal local
 * helper — `bunzip2` ships with every Linux base image the worker runs on.
 */
export function bunzip2ToFile(inPath: string, outPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(outPath);
    // `bunzip2 -c` decompresses to stdout without touching the input file.
    const child = spawn("bunzip2", ["-c", inPath]);
    child.on("error", reject);
    child.stdout.pipe(out);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("close", (code) => {
      out.close();
      if (code === 0) resolve(outPath);
      else reject(new Error(`bunzip2 exited ${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * The descriptor's regular grid as a wgrib2 `-new_grid` spec so the resampled
 * field lands EXACTLY on the dims/bbox the client resolver expects for this
 * nest: `latlon lon0:nx:dlon lat0:ny:dlat`.
 */
function descriptorNewGrid(): { newgrid: string; width: number; height: number; res: number } {
  const source = getSource("icon-d2")!;
  const width = source.dims!.width;
  const height = source.dims!.height;
  const res = source.resolutionDeg;
  const [w, s] = source.bbox;
  const newgrid = `latlon ${w}:${width}:${res} ${s}:${height}:${res}`;
  return { newgrid, width, height, res };
}

/**
 * Resample ONE ICON-D2 GRIB2 field onto the descriptor grid (already
 * −180..180 / regular, so the bake runs with `preRolled: true`) and return the
 * Float32 grid. Runs `wgrib2 IN -match RE -new_grid_winds earth -new_grid ...`.
 */
async function extractOnDescriptorGrid(gribPath: string, match: string, newgrid: string, width: number, height: number): Promise<Float32Array> {
  const outPath = `${gribPath}.rg.grib2`;
  await runWgrib2([
    gribPath,
    "-match", match,
    "-new_grid_winds", "earth",
    "-new_grid", ...newgrid.split(" "),
    outPath,
  ]);
  const field = await extractField({ gribPath: outPath, width, height });
  return field.values;
}

/**
 * ICON-D2 forecast steps. The descriptor is a live nest, so we keep it light:
 * f0..f6 hourly by default (env `ICON_D2_FORECAST_HOURS`), enough for the
 * dead-reckoning window without hammering DWD for the full 48 h.
 */
export function iconD2ForecastSteps(): number[] {
  const max = Number(process.env.ICON_D2_FORECAST_HOURS || 6);
  const out: number[] = [];
  for (let h = 0; h <= max; h++) out.push(h);
  return out;
}

/**
 * Ingest the latest ICON-D2 run and publish it as the "icon-d2" nest.
 * Idempotent + throttled; temp files cleaned in `finally`.
 */
export async function ingestIconD2(now = new Date()): Promise<IngestResult> {
  const source = getSource("icon-d2")!;
  const run = await iconD2LatestAvailableRun(now, headOk);
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }

  const { newgrid, width, height, res } = descriptorNewGrid();
  const steps = iconD2ForecastSteps();
  const variables: Record<string, BakedVariable> = {};
  const tag = (id: string, meta: BakedVariable["meta"]) => (variables[id] ??= { meta, buffers: {} });
  const tmp: string[] = [];

  /** Download + bunzip2 one DWD field for a step; returns the plain GRIB2 path. */
  const fetchField = async (field: string, step: number): Promise<string> => {
    await nomadsGate();
    const bz = await downloadToTemp(buildIconD2Url({ date: run.date, cycle: run.cycle, step, field }), `icond2.${field}.f${padIconD2Step(step)}.grib2.bz2`);
    tmp.push(bz);
    const grib = bz.replace(/\.bz2$/, "");
    await bunzip2ToFile(bz, grib);
    tmp.push(grib);
    return grib;
  };

  try {
    for (const fhr of steps) {
      for (const [variableId, fields] of Object.entries(ICON_D2_VAR_TOKENS)) {
        try {
          if (variableId === "wind") {
            const uPath = await fetchField(fields[0], fhr);
            const vPath = await fetchField(fields[1], fhr);
            const u = await extractOnDescriptorGrid(uPath, ICON_D2_FIELD_MATCH[fields[0]], newgrid, width, height);
            const v = await extractOnDescriptorGrid(vPath, ICON_D2_FIELD_MATCH[fields[1]], newgrid, width, height);
            tmp.push(`${uPath}.rg.grib2`, `${vPath}.rg.grib2`);
            const res2 = await bakeVector({ variableId: "wind", u, v, width, height, preRolled: true });
            tag("wind", { encoding: "uv", units: "m/s", domain: res2.domain, palette: "wind", imageUnscale: res2.imageUnscale, vectorUnscale: res2.imageUnscale, sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority }).buffers[fhr] = res2.buffer;
          } else {
            const field = fields[0];
            const path = await fetchField(field, fhr);
            const values = await extractOnDescriptorGrid(path, ICON_D2_FIELD_MATCH[field], newgrid, width, height);
            tmp.push(`${path}.rg.grib2`);
            // temp K→°C; gust already m/s (skip unit convert).
            const res2 = await bakeScalar({ variableId, values, width, height, preRolled: true, skipUnitConvert: variableId === "gust" });
            tag(variableId, { encoding: "scalar", units: variableId === "temp" ? "°C" : "m/s", domain: res2.domain, palette: variableId, imageUnscale: res2.imageUnscale, sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority }).buffers[fhr] = res2.buffer;
          }
        } catch (err) {
          log(TAG, "icon-d2: bake failed", { fhr, variableId, err: String(err) });
        }
      }
    }

    if (Object.keys(variables).length === 0) {
      throw new Error("no ICON-D2 variables baked (bunzip2 installed? DWD endpoint/token drift?)");
    }

    const bakedSteps = Array.from(
      new Set(Object.values(variables).flatMap((v) => Object.keys(v.buffers).map(Number))),
    ).sort((a, b) => a - b);
    const stepMeta = bakedSteps.map((fhr) => ({ fhr, validTime: new Date(run.runDate.getTime() + fhr * 3600 * 1000).toISOString() }));

    const { runId } = await publishSourceRun({
      model: source.id,
      runDate: run.runDate,
      bounds: [...source.bbox],
      grid: { width, height, res },
      steps: stepMeta,
      variables,
    });
    return { published: true, model: source.id, run: run.runDate.toISOString(), runId, variables: Object.keys(variables) };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}
