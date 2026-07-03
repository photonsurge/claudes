// weather/archive.ts
// Long-term frame archiving: after a run publishes, copy its lowest forecast
// hours (default f000/f003 — effectively the analysis) into the WeatherFrame
// collection, which run retention never touches. That is what powers historical
// point sampling and, later, map replay. Selection logic is pure; the writer
// re-reads texture bytes from Mongo so BOTH publish paths (GFS ingest and
// publishSourceRun) and the backfill script share one code path.

import { log } from "@photonsurge/shared/utill/logger";
import { bufferOf } from "@photonsurge/shared/utill/buffer";
import type {
  iWeatherStep,
  iWeatherVariableEntry,
} from "@photonsurge/shared/db/weather-run-model";

const TAG = "weather:archive";

/** Archiving is on unless explicitly disabled. */
export function archiveEnabled(): boolean {
  return process.env.WEATHER_ARCHIVE !== "off";
}

/**
 * Forecast hours worth archiving per run. f000+f003 gives a 3-hourly history
 * from 6-hourly GFS cycles; sources without those steps just archive what they
 * have that matches.
 */
export function archiveFhrs(): number[] {
  const raw = process.env.WEATHER_ARCHIVE_FHRS || "0,3";
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/** Days of archive to keep; 0 (the default) keeps everything forever. */
export function archiveKeepDays(): number {
  return Number(process.env.WEATHER_ARCHIVE_KEEP_DAYS || 0);
}

/** The steps of a run that should be archived (fhr ∈ wanted). Pure. */
export function selectArchiveSteps(steps: iWeatherStep[], wanted: number[]): iWeatherStep[] {
  const set = new Set(wanted);
  return steps.filter((s) => set.has(s.fhr));
}

/** The already-published run shape archiveRun needs (a WeatherRun doc fits). */
export interface ArchivableRun {
  id: string;
  model: string;
  run: Date | string;
  bounds: number[];
  grid: { width: number; height: number; res: number };
  steps: iWeatherStep[];
  variables: Record<string, iWeatherVariableEntry>;
}

/** The db surface archiveRun touches (subset of getAppDb()). */
export interface ArchiveDb {
  weatherTextures: {
    getByID: (id: string) => Promise<{ success: boolean; data?: any }>;
  };
  weatherFrames: {
    upsert: (frame: any) => Promise<{ written: boolean }>;
    pruneOlderThan: (cutoff: Date) => Promise<number>;
  };
}

/**
 * Copy a published run's archive-eligible steps into WeatherFrame docs.
 * Idempotent (upsert on model+variable+validTime; lower fhr wins), and
 * per-frame resilient: one bad texture skips that frame, not the run.
 */
export async function archiveRun(db: ArchiveDb, run: ArchivableRun): Promise<{ written: number }> {
  if (!archiveEnabled()) return { written: 0 };

  const steps = selectArchiveSteps(run.steps, archiveFhrs());
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
        const res = await db.weatherFrames.upsert({
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
        log(TAG, "frame archive failed, skipped", {
          variable: variableId,
          fhr: step.fhr,
          err: String(ex),
        });
      }
    }
  }

  const keepDays = archiveKeepDays();
  if (keepDays > 0) {
    const cutoff = new Date(Date.now() - keepDays * 24 * 3600 * 1000);
    const pruned = await db.weatherFrames.pruneOlderThan(cutoff).catch(() => 0);
    if (pruned > 0) log(TAG, "pruned old frames", { pruned, keepDays });
  }

  if (written > 0) log(TAG, "archived", { model: run.model, written });
  return { written };
}
