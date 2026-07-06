// weather/hrrr.ts
// Ingest core for the NOAA HRRR 3 km CONUS regional nest. Mirrors
// ingestWaveMosaic / ingestRtofs in multiSource.ts:
//   1. resolve the latest available hourly run,
//   2. SKIP if that model+run is already published (idempotent),
//   3. download the NOMADS GRIB-filter subset per forecast hour,
//   4. wgrib2-regrid HRRR's Lambert grid → a regular lat-lon subset over the
//      HRRR bbox (reusing regridTileToGlobal, the wave-mosaic regrid path),
//   5. bakeVector wind (UGRD/VGRD) + bakeScalar temp (TMP) & gust (GUST),
//   6. publish via publishSourceRun tagged with the descriptor's source meta.
//
// Worker-only: downloads GRIB, bakes textures, stores them in Mongo. Kept free
// of process.exit/loadEnv so callers (manual refresh script or a BullMQ job)
// own the runtime. Handler name suggestion: `refreshHrrr`.

import { getAppDb } from "@photonsurge/shared/db/index";
import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { bakeScalar } from "../grib/bakeScalar";
import { bakeVector } from "../grib/bakeVector";
import { regridTileToGlobal, regridWindPair } from "../merge/mosaic";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { forecastSteps, cfg } from "./config";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";
import {
  buildHrrrUrl,
  hrrrLatestAvailableRun,
  HRRR_PARAMS,
  HRRR_NEWGRID,
  HRRR_GRID,
  type HrrrRun,
} from "../sources/hrrr";

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
 * HRRR forecast hours to bake. HRRR publishes hourly out to f18 (and f48 on the
 * synoptic 00/06/12/18 cycles), but f0 alone is a valid start. We intersect the
 * global weather-config step ladder with the sub-day HRRR window so a single
 * knob (WEATHER_FORECAST_HOURS/STEP) drives every model; f0 is always included.
 */
function hrrrSteps(): number[] {
  const { forecastHours, stepHours } = cfg();
  const maxHrrr = Math.min(forecastHours, 18); // VERIFY: f18 is the guaranteed hourly reach on every cycle.
  const steps = forecastSteps(maxHrrr, stepHours);
  return steps.length ? steps : [0];
}

/**
 * Ingest the latest HRRR CONUS run into a published WeatherRun.
 * Idempotent (skips an already-published run), throttled (nomadsGate), and
 * cleans every temp file in `finally`.
 */
export async function ingestHrrr(now = new Date()): Promise<IngestResult> {
  const source = getSource("hrrr")!;
  const run: HrrrRun = await hrrrLatestAvailableRun(now, headOk);
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }

  const W = HRRR_GRID.width;
  const H = HRRR_GRID.height;
  const steps = hrrrSteps();

  const variables: Record<string, BakedVariable> = {};
  const tag = (id: string, meta: BakedVariable["meta"]) => (variables[id] ??= { meta, buffers: {} });
  const tmp: string[] = [];
  const track = (p: string) => { tmp.push(p); return p; };

  try {
    for (const fhr of steps) {
      // One filtered GRIB2 per forecast hour carrying every field we need.
      let gribPath: string;
      try {
        await nomadsGate();
        gribPath = track(await downloadToTemp(
          buildHrrrUrl({ date: run.date, cycle: run.cycle, fhr, params: Object.values(HRRR_PARAMS) }),
          `hrrr.f${fhr}.grib2`,
        ));
      } catch (err) {
        log(TAG, "hrrr: download failed", { fhr, err: String(err) });
        continue;
      }

      for (const [variableId, spec] of Object.entries(HRRR_PARAMS)) {
        try {
          if (spec.encoding === "uv") {
            // Regrid the U/V PAIR TOGETHER (Lambert → regular lat-lon subset).
            // HRRR winds are grid-relative, so rotating them to earth-relative
            // (-new_grid_winds earth) requires BOTH components in one wgrib2 pass;
            // regridding lone components yields empty output (the black-hole bug).
            const { u, v } = await regridWindPair({
              gribPath,
              outPath: `${gribPath}.${variableId}.uv.rg`,
              matchBoth: `(${spec.match[0]}|${spec.match[1]})`,
              matchU: spec.match[0],
              matchV: spec.match[1],
              newgrid: HRRR_NEWGRID, width: W, height: H,
            });
            track(`${gribPath}.${variableId}.uv.rg`);
            const res = await bakeVector({ variableId, u, v, width: W, height: H, preRolled: true });
            tag(variableId, {
              encoding: "uv", units: "m/s", domain: res.domain, palette: variableId,
              imageUnscale: res.imageUnscale, vectorUnscale: res.imageUnscale,
              sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority,
            }).buffers[fhr] = res.buffer;
          } else {
            const f = await regridTileToGlobal({ gribPath, outPath: `${gribPath}.${variableId}.rg`, match: spec.match[0], newgrid: HRRR_NEWGRID, width: W, height: H });
            track(`${gribPath}.${variableId}.rg`);
            const res = await bakeScalar({ variableId, values: f.values, width: W, height: H, preRolled: true });
            const units = variableId === "temp" ? "°C" : variableId === "pressure" ? "hPa" : "m/s";
            tag(variableId, {
              encoding: "scalar", units, domain: res.domain, palette: variableId,
              imageUnscale: res.imageUnscale,
              sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority,
            }).buffers[fhr] = res.buffer;
          }
        } catch (err) {
          log(TAG, "hrrr: bake failed", { fhr, variableId, err: String(err) });
        }
      }
    }

    if (Object.keys(variables).length === 0) {
      throw new Error("no HRRR variables baked (wgrib2 -new_grid Lambert regrid? NOMADS filter drift?)");
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
