// weather/publishSourceRun.ts
// Persist + atomically publish a WeatherRun baked from ONE source, tagging each
// variable entry with its source metadata (sourceId/resolutionDeg/bbox/priority/
// vectorUnscale). Factored out of the GFS `ingest` publish so the new-source
// refresh scripts (IFS, RTOFS, wave-mosaic) share the exact same create → write
// textures → flip published-last → emit → retention flow.
//
// Runs are keyed by model (= source id), so the public manifest can compose the
// latest run PER variable across models (the remaining public-side step).

import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import type {
  iWeatherVariableEntry,
  iWeatherStep,
} from "@photonsurge/shared/db/weather-run-model";

import { emitWorkerEvent } from "../socket";
import { runRetention } from "./retention";
import { archiveRun } from "./archive";
import { bustManifestCache } from "./manifestCache";

const TAG = "job:weather:source";

/** One baked variable: its entry meta (minus files) + fhr → PNG buffer. */
export interface BakedVariable {
  meta: Omit<iWeatherVariableEntry, "files">;
  /** forecast-hour → baked PNG buffer. */
  buffers: Record<number, Buffer>;
}

export interface PublishSourceRunArgs {
  /** Model id = source id, e.g. "ifs", "rtofs", "gfswave-mosaic". */
  model: string;
  runDate: Date;
  bounds: number[];
  grid: { width: number; height: number; res: number };
  steps: iWeatherStep[];
  variables: Record<string, BakedVariable>;
  retainRuns?: number;
}

/**
 * Create a pending run, write every texture, then flip published LAST (so the
 * browser never sees a half-baked run). Idempotent-friendly: caller decides
 * whether to skip an already-published model+run.
 */
export async function publishSourceRun(args: PublishSourceRunArgs): Promise<{ runId: string }> {
  const db = await getAppDb();
  const { model, runDate, bounds, grid, steps, variables, retainRuns = 3 } = args;

  const created = await db.weatherRuns.create({
    model,
    run: runDate,
    status: "pending",
    published: false,
    bounds: [...bounds],
    grid: { ...grid },
    steps,
    variables: {},
  });
  if (!created.success || !created.data) {
    throw new Error(`publishSourceRun: create failed: ${JSON.stringify(created.errors)}`);
  }
  const runId = created.data.id;

  try {
    const entries: Record<string, iWeatherVariableEntry> = {};
    for (const [variableId, baked] of Object.entries(variables)) {
      const entry: iWeatherVariableEntry = { ...baked.meta, files: {} };
      for (const [fhrStr, buffer] of Object.entries(baked.buffers)) {
        const fhr = Number(fhrStr);
        const tex = await db.weatherTextures.create({
          runId,
          variable: variableId,
          fhr,
          contentType: "image/png",
          encoding: baked.meta.encoding,
          data: buffer,
          byteSize: buffer.byteLength,
        });
        if (!tex.success || !tex.data) {
          throw new Error(`publishSourceRun: texture create failed for ${variableId} f${fhr}`);
        }
        entry.files[String(fhr)] = tex.data.id;
      }
      if (Object.keys(entry.files).length > 0) entries[variableId] = entry;
    }

    if (Object.keys(entries).length === 0) {
      throw new Error("publishSourceRun: no variables baked");
    }

    await db.weatherRuns.updateByID(runId, {
      variables: entries,
      generatedAt: new Date(),
      status: "complete",
      published: true,
    });

    emitWorkerEvent({ type: "weather:run", targetType: "weather", data: { run: runDate.toISOString(), model } });
    // Drop the manifest cache so the map picks up this run now, not in ≤10 min.
    await bustManifestCache();
    await runRetention(db as any, retainRuns);

    // Long-term archive: copy the analysis-hour frames before this run ages
    // out of retention. Never fails the (already published) run.
    await archiveRun(db as any, {
      id: runId,
      model,
      run: runDate,
      bounds: [...bounds],
      grid: { ...grid },
      steps,
      variables: entries,
    }).catch((ex) => log(TAG, "archive failed", { model, err: String(ex) }));

    log(TAG, "published", { model, run: runDate.toISOString(), runId });
    return { runId };
  } catch (ex) {
    log(TAG, "failed, marking run failed", { model, runId });
    await db.weatherRuns.updateByID(runId, { status: "failed", published: false }).catch(() => {});
    await db.weatherTextures.deleteMany({ runId }).catch(() => {});
    throw ex;
  }
}
