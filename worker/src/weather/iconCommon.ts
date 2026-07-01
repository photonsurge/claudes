// weather/iconCommon.ts
// Shared ingest core for the DWD ICON nest family (ICON-D2 2.2 km central-Europe
// and ICON-EU 6.5 km all-Europe). Both nests publish the SAME shape — one
// bzip2-compressed regular-lat-lon GRIB2 per DWD field per step — and differ only
// in the URL builder and the descriptor grid. This module holds everything they
// share: bunzip2, the descriptor `-new_grid` spec, the wind-fixed per-component
// regrid, and the per-step/per-variable bake loop.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

import { getSource, type SourceDescriptor } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { extractField, runWgrib2 } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakeScalar";
import { bakeVector } from "../grib/bakeVector";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { getAppDb } from "@photonsurge/shared/db/index";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";

const TAG = "job:weather:source";

export type IngestResult =
  | { published: true; model: string; run: string; runId: string; variables: string[] }
  | { skipped: true; model: string; run: string; reason: string };

/** True if a complete published run already exists for this model+run time. */
export async function alreadyPublished(model: string, runDate: Date): Promise<boolean> {
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
export function descriptorNewGrid(sourceId: string): { newgrid: string; width: number; height: number; res: number } {
  const source = getSource(sourceId)!;
  const width = source.dims!.width;
  const height = source.dims!.height;
  const res = source.resolutionDeg;
  const [w, s] = source.bbox;
  const newgrid = `latlon ${w}:${width}:${res} ${s}:${height}:${res}`;
  return { newgrid, width, height, res };
}

/**
 * Resample ONE ICON GRIB2 field onto the descriptor grid (already −180..180 /
 * regular, so the bake runs with `preRolled: true`) and return the Float32 grid.
 * Runs `wgrib2 IN -match RE -new_grid ...`.
 *
 * WIND-FIX (approach b): we DELIBERATELY do NOT pass `-new_grid_winds earth`
 * here. `-new_grid_winds earth` only makes sense when U AND V are regridded
 * TOGETHER in one wgrib2 invocation — wgrib2 needs the vector PAIR to rotate
 * grid-relative winds to earth-relative. Feeding it a LONE u (or v) component
 * with `-new_grid_winds earth` produced empty output → the wind texture baked
 * black (temp/gust, being scalars, were unaffected — exactly the symptom seen:
 * wind never attached while temp/gust did).
 *
 * The DWD `regular-lat-lon` ICON variant is ALREADY on a regular grid and its
 * u_10m/v_10m are ALREADY earth-relative (east/north), so no rotation is needed:
 * each component regrids correctly as a plain scalar with `-new_grid` alone.
 * VERIFY: on a live DWD file the two lone-component regrids now yield full-length
 * non-empty grids (extractField throws on short/empty output, so a black texture
 * surfaces as a bake error rather than silently). Scalars (temp/gust/humidity)
 * are unchanged.
 */
export async function extractOnDescriptorGrid(
  gribPath: string,
  match: string,
  newgrid: string,
  width: number,
  height: number,
): Promise<Float32Array> {
  const outPath = `${gribPath}.rg.grib2`;
  await runWgrib2([
    gribPath,
    "-match", match,
    "-new_grid", ...newgrid.split(" "),
    outPath,
  ]);
  const field = await extractField({ gribPath: outPath, width, height });
  return field.values;
}

/**
 * Shared per-run bake loop for an ICON nest. Downloads + bunzip2 + regrids +
 * bakes every variable across every step, then publishes the run. The two ICON
 * ingesters (D2, EU) provide only their per-source knobs via `IconIngestConfig`.
 */
export interface IconIngestConfig {
  /** Source/descriptor id, e.g. "icon-d2" / "icon-eu". */
  sourceId: string;
  /** our variable id → DWD field token(s) (wind → [u,v]; scalars → [field]). */
  varTokens: Record<string, string[]>;
  /** wgrib2 -match token per DWD field. */
  fieldMatch: Record<string, string>;
  /** Build the DWD URL for one (run, step, field). */
  buildUrl: (args: { date: string; cycle: string; step: number; field: string }) => string;
  /** Resolve the latest available run (probe-backed). */
  latestRun: (now: Date, fetchHead: typeof headOk) => Promise<{ date: string; cycle: string; runDate: Date }>;
  /** Forecast steps (hours) to bake. */
  steps: number[];
  /** Zero-pad a step to the DWD 3-digit fff token. */
  padStep: (step: number) => string;
}

export async function ingestIconNest(cfg: IconIngestConfig, now = new Date()): Promise<IngestResult> {
  const source: SourceDescriptor = getSource(cfg.sourceId)!;
  const run = await cfg.latestRun(now, headOk);
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }

  const { newgrid, width, height, res } = descriptorNewGrid(cfg.sourceId);
  const variables: Record<string, BakedVariable> = {};
  const tag = (id: string, meta: BakedVariable["meta"]) => (variables[id] ??= { meta, buffers: {} });
  const tmp: string[] = [];

  /** Download + bunzip2 one DWD field for a step; returns the plain GRIB2 path. */
  const fetchField = async (field: string, step: number): Promise<string> => {
    await nomadsGate();
    const bz = await downloadToTemp(
      cfg.buildUrl({ date: run.date, cycle: run.cycle, step, field }),
      `${cfg.sourceId}.${field}.f${cfg.padStep(step)}.grib2.bz2`,
    );
    tmp.push(bz);
    const grib = bz.replace(/\.bz2$/, "");
    await bunzip2ToFile(bz, grib);
    tmp.push(grib);
    return grib;
  };

  try {
    for (const fhr of cfg.steps) {
      for (const [variableId, fields] of Object.entries(cfg.varTokens)) {
        try {
          if (variableId === "wind") {
            const uPath = await fetchField(fields[0], fhr);
            const vPath = await fetchField(fields[1], fhr);
            const u = await extractOnDescriptorGrid(uPath, cfg.fieldMatch[fields[0]], newgrid, width, height);
            const v = await extractOnDescriptorGrid(vPath, cfg.fieldMatch[fields[1]], newgrid, width, height);
            tmp.push(`${uPath}.rg.grib2`, `${vPath}.rg.grib2`);
            const res2 = await bakeVector({ variableId: "wind", u, v, width, height, preRolled: true });
            tag("wind", {
              encoding: "uv",
              units: "m/s",
              domain: res2.domain,
              palette: "wind",
              imageUnscale: res2.imageUnscale,
              vectorUnscale: res2.imageUnscale,
              sourceId: source.id,
              resolutionDeg: source.resolutionDeg,
              bbox: source.bbox,
              priority: source.priority,
            }).buffers[fhr] = res2.buffer;
          } else {
            const field = fields[0];
            const path = await fetchField(field, fhr);
            const values = await extractOnDescriptorGrid(path, cfg.fieldMatch[field], newgrid, width, height);
            tmp.push(`${path}.rg.grib2`);
            // temp K→°C; gust already m/s, humidity already % (skip unit convert).
            const skipUnitConvert = variableId === "gust" || variableId === "humidity";
            const res2 = await bakeScalar({ variableId, values, width, height, preRolled: true, skipUnitConvert });
            const units = variableId === "temp" ? "°C" : variableId === "humidity" ? "%" : "m/s";
            tag(variableId, {
              encoding: "scalar",
              units,
              domain: res2.domain,
              palette: variableId,
              imageUnscale: res2.imageUnscale,
              sourceId: source.id,
              resolutionDeg: source.resolutionDeg,
              bbox: source.bbox,
              priority: source.priority,
            }).buffers[fhr] = res2.buffer;
          }
        } catch (err) {
          log(TAG, `${cfg.sourceId}: bake failed`, { fhr, variableId, err: String(err) });
        }
      }
    }

    if (Object.keys(variables).length === 0) {
      throw new Error(`no ${cfg.sourceId} variables baked (bunzip2 installed? DWD endpoint/token drift?)`);
    }

    const bakedSteps = Array.from(
      new Set(Object.values(variables).flatMap((v) => Object.keys(v.buffers).map(Number))),
    ).sort((a, b) => a - b);
    const stepMeta = bakedSteps.map((fhr) => ({
      fhr,
      validTime: new Date(run.runDate.getTime() + fhr * 3600 * 1000).toISOString(),
    }));

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
