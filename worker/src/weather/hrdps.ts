// weather/hrdps.ts
// Ingest core for the ECCC HRDPS 2.5 km (Canada) regional NEST. Worker-only:
// download the keyless MSC datamart GRIB2 (one file per field per step) →
// wgrib2-regrid the ROTATED lat-lon native grid onto the descriptor's exact
// regular grid over the hrdps bbox → bake (scalar for temp/gust/humidity, uv
// vector for wind) → publish a per-model run tagged as a nest.
//
// Mirrors ingestHrrr/ingestIconNest: idempotent (skip if the run is already
// published), throttled (nomadsGate), temp cleanup in `finally`, and a failing
// variable is skipped rather than failing the whole run.
//
// WIND-FIX (the HRDPS-specific gotcha): HRDPS native winds are GRID-relative on
// the rotated pole (`winds(grid)` in the header), so u AND v MUST be regridded
// TOGETHER in ONE wgrib2 invocation with `-new_grid_winds earth` to rotate them
// to earth-relative BEFORE bakeVector. We do that by concatenating the U and V
// GRIB2 files and regridding the pair (see `regridWindPair`). Feeding a LONE
// component with `-new_grid_winds earth` yields empty/garbage output — this is
// the OPPOSITE of the DWD ICON regular-lat-lon case (already earth-relative, so
// there the components regrid separately WITHOUT the wind flag).
//
// Suggested handler: `refreshHrdps` (env `HRDPS_INGEST_MS`, default 30 min).

import { readFile, writeFile } from "node:fs/promises";

import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { extractField, runWgrib2 } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakePool";
import { bakeVector } from "../grib/bakePool";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { getAppDb } from "@photonsurge/shared/db/index";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";
import {
  buildHrdpsUrl,
  hrdpsLatestAvailableRun,
  padHrdpsFhr,
  HRDPS_PARAMS,
  HRDPS_NEWGRID,
  HRDPS_GRID,
  type HrdpsRun,
} from "../sources/hrdps";

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
 * HRDPS forecast hours to bake. The descriptor is a live nest, so keep it light:
 * f0..f6 hourly by default (env `HRDPS_FORECAST_HOURS`) — enough for the
 * dead-reckoning window without pulling the full 48 h from the datamart.
 */
export function hrdpsForecastSteps(): number[] {
  const max = Number(process.env.HRDPS_FORECAST_HOURS || 6);
  const out: number[] = [];
  for (let h = 0; h <= max; h++) out.push(h);
  return out;
}

/**
 * Regrid ONE scalar HRDPS field onto the descriptor grid and return the Float32
 * grid. The regridded grid is a bounded regional subset already at the bbox
 * origin, so the bake runs with `preRolled: true` (no 0..360 roll).
 */
async function regridScalar(gribPath: string, match: string): Promise<Float32Array> {
  const outPath = `${gribPath}.rg.grib2`;
  await runWgrib2([
    gribPath,
    "-match", match,
    "-new_grid", ...HRDPS_NEWGRID.split(" "),
    outPath,
  ]);
  const field = await extractField({ gribPath: outPath, width: HRDPS_GRID.width, height: HRDPS_GRID.height });
  return field.values;
}

/**
 * Regrid the U/V PAIR together (the HRDPS wind gotcha). Concatenates the two
 * downloaded GRIB2 files so BOTH components are present in ONE wgrib2 invocation,
 * then runs `-new_grid_winds earth -new_grid ...` to rotate grid-relative winds
 * to earth-relative, and extracts each component off the regridded pair.
 * VERIFIED on a live file: the concatenated pair regrids to `winds(N/S)` and
 * both UGRD/VGRD extract to full-length non-empty grids.
 */
async function regridWindPair(
  uPath: string,
  vPath: string,
  uMatch: string,
  vMatch: string,
): Promise<{ u: Float32Array; v: Float32Array; cleanup: string[] }> {
  const pairPath = `${uPath}.uv.grib2`;
  const outPath = `${pairPath}.rg.grib2`;
  const [uBuf, vBuf] = await Promise.all([readFile(uPath), readFile(vPath)]);
  await writeFile(pairPath, Buffer.concat([uBuf, vBuf]));
  await runWgrib2([
    pairPath,
    "-new_grid_winds", "earth",
    "-new_grid", ...HRDPS_NEWGRID.split(" "),
    outPath,
  ]);
  const u = await extractField({ gribPath: outPath, match: uMatch, width: HRDPS_GRID.width, height: HRDPS_GRID.height });
  const v = await extractField({ gribPath: outPath, match: vMatch, width: HRDPS_GRID.width, height: HRDPS_GRID.height });
  return { u: u.values, v: v.values, cleanup: [pairPath, outPath] };
}

/**
 * Ingest the latest HRDPS continental run and publish it as the "hrdps" nest.
 * Idempotent + throttled; temp files cleaned in `finally`. A field that fails
 * (download or bake) is skipped so a single bad variable doesn't sink the run.
 */
export async function ingestHrdps(now = new Date()): Promise<IngestResult> {
  const source = getSource("hrdps")!;
  const run: HrdpsRun = await hrdpsLatestAvailableRun(now, headOk);
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }

  const W = HRDPS_GRID.width;
  const H = HRDPS_GRID.height;
  const steps = hrdpsForecastSteps();

  const variables: Record<string, BakedVariable> = {};
  const tag = (id: string, meta: BakedVariable["meta"]) => (variables[id] ??= { meta, buffers: {} });
  const tmp: string[] = [];
  const track = (p: string) => { tmp.push(p); return p; };

  /** Download ONE datamart field GRIB2 for a step; returns the temp path. */
  const fetchField = async (token: string, fhr: number): Promise<string> => {
    await nomadsGate();
    return track(await downloadToTemp(
      buildHrdpsUrl({ date: run.date, cycle: run.cycle, fhr, token }),
      `hrdps.${token}.f${padHrdpsFhr(fhr)}.grib2`,
    ));
  };

  try {
    for (const fhr of steps) {
      for (const [variableId, spec] of Object.entries(HRDPS_PARAMS)) {
        try {
          if (spec.encoding === "uv") {
            const uPath = await fetchField(spec.tokens[0], fhr);
            const vPath = await fetchField(spec.tokens[1], fhr);
            const { u, v, cleanup } = await regridWindPair(uPath, vPath, spec.match[0], spec.match[1]);
            cleanup.forEach(track);
            const res = await bakeVector({ variableId, u, v, width: W, height: H, preRolled: true });
            tag(variableId, {
              encoding: "uv", units: "m/s", domain: res.domain, palette: variableId,
              imageUnscale: res.imageUnscale, vectorUnscale: res.imageUnscale,
              sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority,
            }).buffers[fhr] = res.buffer;
          } else {
            const path = await fetchField(spec.tokens[0], fhr);
            const values = await regridScalar(path, spec.match[0]);
            track(`${path}.rg.grib2`);
            // temp K→°C, pressure Pa→hPa via convertScalarUnits; gust already m/s, humidity already %.
            const skipUnitConvert = variableId === "gust" || variableId === "humidity";
            const res = await bakeScalar({ variableId, values, width: W, height: H, preRolled: true, skipUnitConvert });
            const units =
              variableId === "temp" ? "°C" : variableId === "humidity" ? "%" : variableId === "pressure" ? "hPa" : "m/s";
            tag(variableId, {
              encoding: "scalar", units, domain: res.domain, palette: variableId,
              imageUnscale: res.imageUnscale,
              sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority,
            }).buffers[fhr] = res.buffer;
          }
        } catch (err) {
          log(TAG, "hrdps: bake failed", { fhr, variableId, err: String(err) });
        }
      }
    }

    if (Object.keys(variables).length === 0) {
      throw new Error("no HRDPS variables baked (wgrib2 rotated→regular regrid? datamart token/path drift?)");
    }

    const baked = new Set<number>();
    for (const v of Object.values(variables)) for (const k of Object.keys(v.buffers)) baked.add(Number(k));
    const stepMeta = [...baked].sort((a, b) => a - b).map((fhr) => ({
      fhr, validTime: new Date(run.runDate.getTime() + fhr * 3600 * 1000).toISOString(),
    }));

    const { runId } = await publishSourceRun({
      model: source.id,
      runDate: run.runDate,
      bounds: [...source.bbox],
      grid: { width: W, height: H, res: source.resolutionDeg },
      steps: stepMeta,
      variables,
    });
    return { published: true, model: source.id, run: run.runDate.toISOString(), runId, variables: Object.keys(variables) };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}
