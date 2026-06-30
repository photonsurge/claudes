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
import { scalarKeepMask } from "../grib/bakeScalar";
import {
  syntheticWind,
  syntheticTemp,
  syntheticSst,
  syntheticCloud,
  syntheticSnow,
  syntheticWave,
  syntheticLandMask,
} from "./synthetic";
import { cfg } from "./config";

/** GRIB UNDEFINED sentinel — bake-time nodata marker for ocean-only fields. */
const SENTINEL = 1e21;

/**
 * Synthetic scalar fields seeded alongside wind, in display units. `oceanOnly`
 * fields (wave) get land pixels stamped with the GRIB UNDEFINED sentinel so the
 * existing nodata path bakes them transparent — exactly like real HTSGW.
 */
const SYNTHETIC_SCALARS: {
  id: string;
  gen: (w: number, h: number) => Float32Array;
  oceanOnly?: boolean;
}[] = [
  { id: "temp", gen: syntheticTemp },
  { id: "sst", gen: syntheticSst },
  { id: "cloud", gen: syntheticCloud },
  { id: "snow", gen: syntheticSnow },
  { id: "wave", gen: syntheticWave, oceanOnly: true },
];

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
  // Scalars (temp/sst/cloud/snow), each reusing the registry meta + decode range.
  const scalarEntries: Record<string, iWeatherVariableEntry> = {};
  for (const { id } of SYNTHETIC_SCALARS) {
    const meta = VARIABLE_REGISTRY[id];
    scalarEntries[id] = {
      encoding: "scalar",
      units: meta.units,
      domain: [meta.domain[0], meta.domain[1]],
      palette: meta.palette,
      imageUnscale: imageUnscaleFor(id),
      files: {},
    };
  }

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

    // Synthetic land mask shared by any masked scalar (sst→sea, snow→land).
    const land = syntheticLandMask(width, height);
    for (const { id, gen, oceanOnly } of SYNTHETIC_SCALARS) {
      const values = gen(width, height);
      // Ocean-only fields (wave) carry no registry land mask — stamp land with
      // the GRIB sentinel so scalarKeepMask drops it, mirroring real HTSGW.
      if (oceanOnly) for (let i = 0; i < values.length; i++) if (land[i] >= 0.5) values[i] = SENTINEL;
      // Synthetic fields are already −180..180, so no longitude roll: mask in place.
      const keep = scalarKeepMask(id, values, land);
      const png = await encodeScalarPng(values, width, height, imageUnscaleFor(id), keep);
      const tex = await db.weatherTextures.create({
        runId,
        variable: id,
        fhr,
        contentType: "image/png",
        encoding: "scalar",
        data: png,
        byteSize: png.byteLength,
      });
      if (!tex.success || !tex.data) throw new Error(`seedSample: ${id} texture failed`);
      scalarEntries[id].files[String(fhr)] = tex.data.id;
    }
  }

  variables.wind = windEntry;
  for (const { id } of SYNTHETIC_SCALARS) variables[id] = scalarEntries[id];

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
