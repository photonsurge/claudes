// jobs/weather.ts
// Weather ingest pipeline handlers. The worker loader registers EVERY exported
// function in this file as a job handler, so ONLY the three real handlers
// (check / ingest / seedSample) are exported. All helpers live in ../sources,
// ../grib and ../weather, or as non-exported locals below.

import type { Job } from "bullmq";

import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToQueue } from "@photonsurge/shared/bull/bull-queue";
import { log } from "@photonsurge/shared/utill/logger";
import {
  VARIABLE_REGISTRY,
  type iVariableMeta,
} from "@photonsurge/shared/variables";
import type {
  iWeatherVariableEntry,
  iWeatherStep,
} from "@photonsurge/shared/db/weather-run-model";

import { emitWorkerEvent } from "../socket";
import {
  buildNomadsUrl,
  latestAvailableRun,
  padFhr,
  type LatestRun,
} from "../sources/gfs";
import { extractField } from "../grib/wgrib2";
import { GFS_GRID, GFS_BOUNDS } from "../grib/bake";
import { bakeWind } from "../grib/bakeWind";
import { bakeScalar } from "../grib/bakeScalar";
import { syntheticWind, syntheticTemp } from "../weather/synthetic";
import { encodeWindPng, encodeScalarPng } from "../grib/encode";
import { imageUnscaleFor, WIND_IMAGE_UNSCALE } from "../grib/bake";
import { runRetention } from "../weather/retention";
import { downloadToTemp, cleanupTemp, headOk } from "../weather/download";

const TAG = "job:weather";
const DOMAIN = "weather";

// ── env config ───────────────────────────────────────────────────────────────
const cfg = () => ({
  model: process.env.MODEL || "gfs",
  forecastHours: Number(process.env.FORECAST_HOURS || 48),
  stepHours: Number(process.env.STEP_HOURS || 3),
  retainRuns: Number(process.env.RETAIN_RUNS || 3),
});

/** Forecast steps f000..FORECAST_HOURS by STEP_HOURS. */
function forecastSteps(forecastHours: number, stepHours: number): number[] {
  const out: number[] = [];
  for (let f = 0; f <= forecastHours; f += Math.max(1, stepHours)) out.push(f);
  return out;
}

// ── check ─────────────────────────────────────────────────────────────────────
/**
 * Determine the latest available GFS run; if it is newer than the latest
 * published run in the DB, enqueue an ingest job. Otherwise no-op.
 */
export async function check(_job: Job) {
  const { model } = cfg();
  const db = await getAppDb();

  const latest: LatestRun = await latestAvailableRun(new Date(), headOk);
  const published = await db.latestPublishedRun();
  const publishedTime = published?.run ? new Date(published.run).getTime() : 0;

  if (latest.runDate.getTime() <= publishedTime) {
    log(TAG, "check: up to date", { latest: latest.runDate.toISOString() });
    return { upToDate: true, latest: latest.runDate.toISOString() };
  }

  log(TAG, "check: newer run available -> enqueue ingest", {
    date: latest.date,
    cycle: latest.cycle,
  });
  await sendToQueue(DOMAIN, "weather", "ingest", {
    date: latest.date,
    cycle: latest.cycle,
    model,
  });
  return { enqueued: true, date: latest.date, cycle: latest.cycle };
}

// ── ingest ──────────────────────────────────────────────────────────────────────
function runDateFor(date: string, cycle: string): Date {
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(4, 6)) - 1;
  const d = Number(date.slice(6, 8));
  return new Date(Date.UTC(y, mo, d, Number(cycle), 0, 0, 0));
}

/** Download + bake a single variable at a single fhr. Returns the PNG buffer + meta. */
async function bakeVariableStep(
  variable: iVariableMeta,
  date: string,
  cycle: string,
  fhr: number,
  prevAccumPath: string | undefined,
  stepHours: number,
): Promise<{ buffer: Buffer; imageUnscale: [number, number]; domain: [number, number]; encoding: "uv" | "scalar"; gribPath: string }> {
  const url = buildNomadsUrl({
    date,
    cycle,
    fhr,
    vars: variable.gfs.vars,
    levels: variable.gfs.levels,
  });
  const gribPath = await downloadToTemp(url, `${variable.id}.f${padFhr(fhr)}.grib2`);

  if (variable.encoding === "uv") {
    const u = await extractField({ gribPath, match: `:${variable.gfs.vars[0]}:`, ...GFS_GRID });
    const v = await extractField({ gribPath, match: `:${variable.gfs.vars[1]}:`, ...GFS_GRID });
    const res = await bakeWind({ u: u.values, v: v.values, width: u.width, height: u.height });
    return { ...res, gribPath };
  }

  const field = await extractField({ gribPath, match: `:${variable.gfs.vars[0]}:`, ...GFS_GRID });
  let prevValues: Float32Array | undefined;
  let deltaHours: number | undefined;
  if (variable.gfs.accumulated && prevAccumPath) {
    const prev = await extractField({ gribPath: prevAccumPath, match: `:${variable.gfs.vars[0]}:`, ...GFS_GRID });
    prevValues = prev.values;
    deltaHours = stepHours;
  }
  const res = await bakeScalar({
    variableId: variable.id,
    values: field.values,
    width: field.width,
    height: field.height,
    prevValues,
    deltaHours,
  });
  return { ...res, gribPath };
}

/**
 * Ingest a full run: create a pending WeatherRun, bake every variable at every
 * forecast step, persist textures, then atomically publish (published flips
 * LAST). Idempotent on model+run. If any bake fails the run is marked failed and
 * never published.
 */
export async function ingest(job: Job) {
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

      variables[variable.id] = entry;
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

// ── seedSample ───────────────────────────────────────────────────────────────
/**
 * Build a SYNTHETIC published run (no network / no wgrib2) so /watch is
 * demoable. Generates procedural wind + temp fields, encodes them through the
 * SAME PNG encoders, stores textures and a published WeatherRun. Reuses the real
 * WeatherRun / WeatherTexture shapes.
 */
export async function seedSample(job: Job) {
  const { model } = cfg();
  const data = job.data?.data ?? {};
  // Default to a modest grid for a quick demo seed; allow full grid via payload.
  const width = Number(data.width || 360);
  const height = Number(data.height || 181);
  const fhrs: number[] = Array.isArray(data.fhrs) && data.fhrs.length ? data.fhrs.map(Number) : [0];

  const db = await getAppDb();
  const runDate = new Date();

  const steps: iWeatherStep[] = fhrs.map((fhr) => ({
    fhr,
    validTime: new Date(runDate.getTime() + fhr * 3600 * 1000).toISOString(),
  }));

  const created = await db.weatherRuns.create({
    model: `${model}-sample`,
    run: runDate,
    status: "pending",
    published: false,
    bounds: [...GFS_BOUNDS],
    grid: { width, height, res: 360 / width },
    steps,
    variables: {},
  });
  if (!created.success || !created.data) throw new Error("seedSample: create run failed");
  const runId = created.data.id;

  const variables: Record<string, iWeatherVariableEntry> = {};

  // Wind (uv)
  const windEntry: iWeatherVariableEntry = {
    encoding: "uv",
    units: VARIABLE_REGISTRY.wind.units,
    domain: [VARIABLE_REGISTRY.wind.domain[0], VARIABLE_REGISTRY.wind.domain[1]],
    palette: VARIABLE_REGISTRY.wind.palette,
    imageUnscale: WIND_IMAGE_UNSCALE,
    files: {},
  };
  // Temp (scalar)
  const tempUnscale = imageUnscaleFor("temp");
  const tempEntry: iWeatherVariableEntry = {
    encoding: "scalar",
    units: VARIABLE_REGISTRY.temp.units,
    domain: [VARIABLE_REGISTRY.temp.domain[0], VARIABLE_REGISTRY.temp.domain[1]],
    palette: VARIABLE_REGISTRY.temp.palette,
    imageUnscale: tempUnscale,
    files: {},
  };

  for (const fhr of fhrs) {
    const { u, v } = syntheticWind(width, height);
    const windPng = await encodeWindPng(u, v, width, height, WIND_IMAGE_UNSCALE);
    const windTex = await db.weatherTextures.create({
      runId,
      variable: "wind",
      fhr,
      contentType: "image/png",
      encoding: "uv",
      data: windPng,
      byteSize: windPng.byteLength,
    });
    if (!windTex.success || !windTex.data) throw new Error("seedSample: wind texture failed");
    windEntry.files[String(fhr)] = windTex.data.id;

    const temp = syntheticTemp(width, height);
    const tempPng = await encodeScalarPng(temp, width, height, tempUnscale);
    const tempTex = await db.weatherTextures.create({
      runId,
      variable: "temp",
      fhr,
      contentType: "image/png",
      encoding: "scalar",
      data: tempPng,
      byteSize: tempPng.byteLength,
    });
    if (!tempTex.success || !tempTex.data) throw new Error("seedSample: temp texture failed");
    tempEntry.files[String(fhr)] = tempTex.data.id;
  }

  variables.wind = windEntry;
  variables.temp = tempEntry;

  await db.weatherRuns.updateByID(runId, {
    variables,
    generatedAt: new Date(),
    status: "complete",
    published: true,
  });

  emitWorkerEvent({
    type: "weather:run",
    targetType: "weather",
    data: { run: runDate.toISOString(), sample: true },
  });

  log(TAG, "seedSample: published", { runId, width, height, fhrs });
  return { published: true, runId, run: runDate.toISOString() };
}
