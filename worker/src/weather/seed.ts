// weather/seed.ts
// `seedSample` handler internals: build a SYNTHETIC published run (no network / no
// wgrib2) so /watch is demoable. Generates procedural wind + temp fields, encodes
// them through the SAME PNG encoders, stores textures and a published WeatherRun.

import type { Job } from "bullmq";

import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";
import type {
  iWeatherVariableEntry,
  iWeatherStep,
} from "@photonsurge/shared/db/weather-run-model";

import { emitWorkerEvent } from "../socket";
import { GFS_BOUNDS, imageUnscaleFor, WIND_IMAGE_UNSCALE } from "../grib/bake";
import { encodeWindPng, encodeScalarPng } from "../grib/encode";
import { syntheticWind, syntheticTemp } from "./synthetic";
import { cfg } from "./config";

const TAG = "job:weather";

/**
 * Build a SYNTHETIC published run (no network / no wgrib2) so /watch is
 * demoable. Generates procedural wind + temp fields, encodes them through the
 * SAME PNG encoders, stores textures and a published WeatherRun. Reuses the real
 * WeatherRun / WeatherTexture shapes.
 */
export async function runSeedSample(job: Job) {
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
