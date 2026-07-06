// weather/ingest.ts
// `ingest` handler internals: bake a full GFS run into textures and atomically
// publish it. Per-variable resilience, idempotency, atomic publish (published
// flips LAST), retention and the `weather:run` emit all live here.

import type { Job } from "bullmq";

import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";
import type {
  iWeatherVariableEntry,
  iWeatherStep,
} from "@photonsurge/shared/db/weather-run-model";

import { emitWorkerEvent } from "../socket";
import { GFS_GRID, GFS_BOUNDS } from "../grib/bake";
import { runRetention } from "./retention";
import { archiveRun } from "./archive";
import { archiveForecastRun } from "./archiveForecast";
import { cleanupTemp } from "./download";
import { cfg, forecastSteps, runDateFor } from "./config";
import { bakeVariableStep } from "./bakeVariableStep";

const TAG = "job:weather";

/**
 * Ingest a full run: create a pending WeatherRun, bake every variable at every
 * forecast step, persist textures, then atomically publish (published flips
 * LAST). Idempotent on model+run. If any bake fails the run is marked failed and
 * never published.
 */
export async function runIngest(job: Job) {
  const { model, forecastHours, stepHours, retainRuns } = cfg();
  const data = job.data?.data ?? {};
  const date: string = data.date;
  const cycle: string = data.cycle;
  if (!date || !cycle) throw new Error("ingest: missing date/cycle");

  const db = await getAppDb();
  const runDate = runDateFor(date, cycle);

  // Idempotency: skip if a complete published run already exists for model+run.
  const existing = await db.weatherRuns.getByQuery({
    model,
    run: runDate,
    status: "complete",
    published: true,
  });
  if (existing.success && existing.data) {
    log(TAG, "ingest: already published, skipping", { run: runDate.toISOString() });
    return { skipped: true, run: runDate.toISOString() };
  }

  const steps: iWeatherStep[] = forecastSteps(forecastHours, stepHours).map((fhr) => ({
    fhr,
    validTime: new Date(runDate.getTime() + fhr * 3600 * 1000).toISOString(),
  }));

  const created = await db.weatherRuns.create({
    model,
    run: runDate,
    status: "pending",
    published: false,
    bounds: [...GFS_BOUNDS],
    grid: { ...GFS_GRID },
    steps,
    variables: {},
  });
  if (!created.success || !created.data) {
    throw new Error(`ingest: failed to create run doc: ${JSON.stringify(created.errors)}`);
  }
  const runId = created.data.id;
  const tempPaths: string[] = [];

  try {
    const variables: Record<string, iWeatherVariableEntry> = {};

    for (const variable of Object.values(VARIABLE_REGISTRY)) {
      // GFS ingest only handles variables with a GFS binding. Ocean-only vars
      // (current/salinity, and RTOFS-preferred SST) are baked by their own
      // source path; GFS still supplies masked SST here as the fallback.
      if (!variable.gfs) continue;
      // Each variable is independent: a missing field (e.g. APCP/rain has no
      // record at f000) skips just that variable, it doesn't fail the whole run.
      try {
        const entry: iWeatherVariableEntry = {
          encoding: variable.encoding,
          units: variable.units,
          domain: [variable.domain[0], variable.domain[1]],
          palette: variable.palette,
          files: {},
        };

        let prevAccumPath: string | undefined;
        for (const fhr of forecastSteps(forecastHours, stepHours)) {
          const baked = await bakeVariableStep(variable, date, cycle, fhr, prevAccumPath, stepHours);
          tempPaths.push(baked.gribPath);
          if (variable.gfs.accumulated) prevAccumPath = baked.gribPath;

          entry.imageUnscale = baked.imageUnscale;
          if (baked.encoding === "scalar") entry.domain = baked.domain;

          const tex = await db.weatherTextures.create({
            runId,
            variable: variable.id,
            fhr,
            contentType: "image/png",
            encoding: baked.encoding,
            data: baked.buffer,
            byteSize: baked.buffer.byteLength,
          });
          if (!tex.success || !tex.data) {
            throw new Error(`ingest: texture create failed for ${variable.id} f${fhr}`);
          }
          entry.files[String(fhr)] = tex.data.id;
        }

        if (Object.keys(entry.files).length > 0) variables[variable.id] = entry;
      } catch (varErr) {
        log(TAG, "ingest: variable skipped", { variable: variable.id, err: String(varErr) });
        await db.weatherTextures.deleteMany({ runId, variable: variable.id }).catch(() => {});
      }
    }

    if (Object.keys(variables).length === 0) {
      throw new Error("ingest: no variables baked (all fields failed)");
    }

    // Atomic publish: published flips LAST, only after every texture exists.
    await db.weatherRuns.updateByID(runId, {
      variables,
      generatedAt: new Date(),
      status: "complete",
      published: true,
    });

    emitWorkerEvent({
      type: "weather:run",
      targetType: "weather",
      data: { run: runDate.toISOString() },
    });

    await runRetention(db as any, retainRuns);

    // Long-term archive: copy the analysis-hour frames before this run ages
    // out of retention. Never fails the (already published) run.
    await archiveRun(db as any, {
      id: runId,
      model,
      run: runDate,
      bounds: [...GFS_BOUNDS],
      grid: { ...GFS_GRID },
      steps,
      variables,
    }).catch((ex) => log(TAG, "ingest: archive failed", { err: String(ex) }));

    // Rolling forecast store: copy every baked step so the next few days'
    // predictions are durably queryable (unlike the run's own textures, which
    // retention prunes after a few cycles). Never fails the published run.
    await archiveForecastRun(db as any, {
      id: runId,
      model,
      run: runDate,
      bounds: [...GFS_BOUNDS],
      grid: { ...GFS_GRID },
      steps,
      variables,
    }).catch((ex) => log(TAG, "ingest: forecast archive failed", { err: String(ex) }));

    log(TAG, "ingest: published", { run: runDate.toISOString(), runId });
    return { published: true, run: runDate.toISOString(), runId };
  } catch (ex) {
    log(TAG, "ingest: failed, marking run failed", { runId });
    await db.weatherRuns.updateByID(runId, { status: "failed", published: false }).catch(() => {});
    // Roll back partial textures so we never leave orphans.
    await db.weatherTextures.deleteMany({ runId }).catch(() => {});
    throw ex;
  } finally {
    for (const p of tempPaths) await cleanupTemp(p);
  }
}
