// weather/archiveForecast.ts
// Rolling forecast archiving: after a run publishes, copy ALL of its baked
// forecast-hour steps (unlike archive.ts's curated f000/f003, the whole point
// here is the 3-hourly curve out to FORECAST_HOURS) into the
// WeatherForecastFrame collection. Newer runs supersede older ones for the
// same future validTime, and elapsed validTimes get pruned rather than kept
// forever. Sibling to archive.ts rather than a modification of it: the
// wins-semantics and fhr selection are inverted, so keeping them separate
// avoids a single module branching on two incompatible upsert rules.

import { log } from "@photonsurge/shared/utill/logger";
import { bufferOf } from "@photonsurge/shared/utill/buffer";
import type { iWeatherStep } from "@photonsurge/shared/db/weather-run-model";
import type { ArchivableRun } from "./archive";

const TAG = "weather:archiveForecast";

/** Forecast archiving is on unless explicitly disabled. */
export function forecastArchiveEnabled(): boolean {
  return process.env.WEATHER_FORECAST_ARCHIVE !== "off";
}

/** Every step a run baked is forecast-archive-eligible — no curation. Pure. */
export function selectForecastSteps(steps: iWeatherStep[]): iWeatherStep[] {
  return steps;
}

/** The db surface archiveForecastRun touches (subset of getAppDb()). */
export interface ForecastArchiveDb {
  weatherTextures: {
    getByID: (id: string) => Promise<{ success: boolean; data?: any }>;
  };
  weatherForecastFrames: {
    upsert: (frame: any) => Promise<{ written: boolean }>;
    pruneOlderThan: (cutoff: Date) => Promise<number>;
  };
}

/**
 * Copy a published run's steps into WeatherForecastFrame docs. Idempotent
 * (upsert on model+variable+validTime; newer run wins), and per-frame
 * resilient: one bad texture skips that frame, not the run. Afterward prunes
 * validTimes that have already elapsed (a small grace window keeps the just-
 * passed hour readable a little longer).
 */
export async function archiveForecastRun(
  db: ForecastArchiveDb,
  run: ArchivableRun,
): Promise<{ written: number }> {
  if (!forecastArchiveEnabled()) return { written: 0 };

  const steps = selectForecastSteps(run.steps);
  let written = 0;

  for (const [variableId, entry] of Object.entries(run.variables)) {
    for (const step of steps) {
      const texId = entry.files?.[String(step.fhr)];
      if (!texId) continue;
      try {
        const tex = await db.weatherTextures.getByID(texId);
        const data = tex.success && tex.data ? bufferOf(tex.data.data) : Buffer.alloc(0);
        if (data.byteLength === 0) {
          log(TAG, "empty texture, frame skipped", { variable: variableId, fhr: step.fhr });
          continue;
        }
        const res = await db.weatherForecastFrames.upsert({
          model: run.model,
          variable: variableId,
          validTime: new Date(step.validTime),
          run: new Date(run.run),
          fhr: step.fhr,
          encoding: entry.encoding,
          units: entry.units ?? "",
          imageUnscale: entry.imageUnscale,
          vectorUnscale: entry.vectorUnscale,
          bounds: [...run.bounds],
          grid: { ...run.grid },
          contentType: "image/png",
          data,
          byteSize: data.byteLength,
        });
        if (res.written) written += 1;
      } catch (ex) {
        log(TAG, "forecast frame archive failed, skipped", {
          variable: variableId,
          fhr: step.fhr,
          err: String(ex),
        });
      }
    }
  }

  const cutoff = new Date(Date.now() - 3 * 3600 * 1000);
  const pruned = await db.weatherForecastFrames.pruneOlderThan(cutoff).catch(() => 0);
  if (pruned > 0) log(TAG, "pruned elapsed forecast frames", { pruned });

  if (written > 0) log(TAG, "forecast archived", { model: run.model, written });
  return { written };
}
