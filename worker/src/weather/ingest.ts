// weather/ingest.ts
// `ingest` handler internals: bake a full GFS run into textures and publish it.
//
// PROGRESSIVE, not all-or-nothing: the run doc is created BEFORE any baking so it
// appears in /admin/weather from the start (status "pending"), and each variable
// is PUBLISHED the moment its own maps finish baking — an atomic per-variable
// `$set` into `variables.<id>` plus a manifest-cache bust — so the map fills in
// field-by-field instead of waiting for the whole ~8-min run. Variables bake in
// PARALLEL (bounded), reading each forecast hour's `.idx` once (download-once via
// the shared idx cache + in-flight coalescing in download.ts). Per-forecast-hour
// and per-variable resilience is preserved: a missing tail hour skips only that
// hour, a dead field skips only that field, and the run still publishes whatever
// baked. Idempotency + the concurrency guard gate the start.

import type { Job } from "bullmq";

import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";
import type { iVariableMeta } from "@photonsurge/shared/variables";
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
import { cfg, bakeSteps, runDateFor } from "./config";
import { bakeVariableStep } from "./bakeVariableStep";
import { blogInfo, blogWarn, blogErr } from "../blog";
import { dbg } from "./debug";
import { bustManifestCache } from "./manifestCache";
import { recentPendingRun } from "./inflight";

const TAG = "job:weather";

/** How many variables bake at once. wgrib2 runs as a subprocess, so parallel
 *  variables genuinely use multiple cores; kept modest to leave headroom for the
 *  worker's other jobs. Override with WEATHER_BAKE_CONCURRENCY. */
const BAKE_CONCURRENCY = Math.max(1, Number(process.env.WEATHER_BAKE_CONCURRENCY) || 4);

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function withConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

/**
 * Ingest a full run: create a pending WeatherRun (visible immediately), bake
 * every variable at every forecast step in parallel, and publish each variable's
 * maps as soon as they are baked. Idempotent on model+run (unless forced). If
 * NOTHING bakes the run is marked failed; a partial run stays published.
 */
export async function runIngest(job: Job) {
  const config = cfg();
  const { model, stepHours, retainRuns } = config;
  const data = job.data?.data ?? {};
  const date: string = data.date;
  const cycle: string = data.cycle;
  // `force` (the "Remake weather" button) rebakes even an already-published
  // cycle: it bakes a FRESH run doc while the old one stays live until the new
  // one starts publishing its variables. A normal check-driven ingest keeps its
  // idempotency skip (no needless double-bake).
  const force: boolean = !!data.force;
  if (!date || !cycle) throw new Error("ingest: missing date/cycle");

  const db = await getAppDb();
  const runDate = runDateFor(date, cycle);

  // Concurrency guard (applies even to force): never bake the same cycle twice at
  // once. If another ingest for this exact model+cycle is already in flight (a
  // recent pending run doc), skip — the hard backstop against duplicate
  // `weather.ingest` jobs racing. A stale pending doc (crashed bake) is ignored
  // by `recentPendingRun`, so a dead run can't wedge the queue.
  const inFlight = await recentPendingRun(db, model, runDate);
  if (inFlight) {
    log(TAG, "ingest: another bake in flight for this cycle, skipping", {
      run: runDate.toISOString(),
      inFlightRunId: inFlight.id,
    });
    return { skipped: true, reason: "in-flight", run: runDate.toISOString() };
  }

  // Idempotency: skip if a complete published run already exists for model+run —
  // unless forced, when we deliberately rebake it.
  if (!force) {
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
  }

  // The 3-hourly detailed track (0..72h) unioned with the 12-hourly daily
  // outlook (0..384h). Computed once and reused for the run doc and the bake.
  const bakedFhrs = bakeSteps(config);
  const steps: iWeatherStep[] = bakedFhrs.map((fhr) => ({
    fhr,
    validTime: new Date(runDate.getTime() + fhr * 3600 * 1000).toISOString(),
  }));

  // Create the run doc FIRST (pending, unpublished) so it appears in
  // /admin/weather from the instant baking begins.
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

  // Only GFS-bound variables are baked here (ocean-only vars have their own
  // source path). Counted up-front so the lifecycle logs report progress.
  const gfsVars = Object.values(VARIABLE_REGISTRY).filter((v) => v.gfs);
  const startedAt = Date.now();
  blogInfo(
    TAG,
    `ingest start: gfs ${date}/${cycle}z — ${gfsVars.length} vars × ${steps.length} steps (parallel, progressive)`,
    { date, cycle, vars: gfsVars.length, steps: steps.length },
    "weather",
    "ingest",
  );

  // Variables that produced NO usable hour, with why (a total wipe-out surfaces
  // its cause), and variables published with gaps.
  const skipped: Array<{ variable: string; err: string }> = [];
  const degraded: Array<{ variable: string; missing: number[] }> = [];
  // Entries actually published, kept for the archive/forecast copy at the end.
  const publishedVars: Record<string, iWeatherVariableEntry> = {};
  let firstPublished = false;
  // Set if our run doc disappears mid-bake (a concurrent clear, or the
  // retention-prunes-in-flight bug). We then stop baking into the void and fail
  // the job loudly instead of logging phantom "published" lines.
  let runVanished = false;
  // Serialise the run-doc writes + cache busts so parallel variables never race
  // on the publish step (the per-variable `$set` is atomic, but ordering the
  // published/generatedAt flip and the cache bust keeps it clean).
  let publishChain: Promise<void> = Promise.resolve();
  const publishVariable = (variable: iVariableMeta, entry: iWeatherVariableEntry): Promise<void> => {
    publishChain = publishChain.then(async () => {
      const patch: Record<string, unknown> = { [`variables.${variable.id}`]: entry };
      // The first baked variable flips the run published + stamps generatedAt, so
      // it immediately outranks any prior run for this cycle and its maps show.
      if (!firstPublished) {
        patch.published = true;
        patch.generatedAt = new Date();
        firstPublished = true;
      }
      const upd = await db.weatherRuns.updateByID(runId, patch as any);
      // Doc gone → stop; don't record it as published or bust the cache for a
      // run that no longer exists. The post-loop check turns this into a failure.
      if (!upd.success) {
        runVanished = true;
        return;
      }
      publishedVars[variable.id] = entry;
      // Map picks up the newly-published field now, not in ≤10 min.
      await bustManifestCache();
      if (!firstPublished) return;
      emitWorkerEvent({ type: "weather:run", targetType: "weather", data: { run: runDate.toISOString() } });
    });
    return publishChain;
  };

  /** Bake ALL forecast hours for one variable, then publish it. Never throws. */
  const bakeOneVariable = async (variable: iVariableMeta): Promise<void> => {
    if (runVanished) return; // run was deleted under us — don't keep baking
    const vStart = Date.now();
    log(TAG, `ingest: baking ${variable.id}`, { run: runDate.toISOString(), steps: bakedFhrs.length });

    const entry: iWeatherVariableEntry = {
      encoding: variable.encoding,
      units: variable.units,
      domain: [variable.domain[0], variable.domain[1]],
      palette: variable.palette,
      files: {},
    };

    let prevAccumPath: string | undefined;
    let prevFhr: number | undefined;
    const fhrErrors: Array<{ fhr: number; err: string }> = [];

    for (const fhr of bakedFhrs) {
      // Each forecast hour is independent: a missing/failed step (not-yet-posted
      // tail hour, or one throttled download) skips ONLY that hour.
      try {
        // Accumulated fields (precip) diff against the previous baked step; the
        // window widens correctly across any skipped hour since prevFhr only
        // advances on success. Ordering within a variable is why each variable
        // bakes its hours sequentially (parallelism is ACROSS variables).
        const windowHours = prevFhr === undefined ? stepHours : fhr - prevFhr;
        const baked = await bakeVariableStep(variable, date, cycle, fhr, prevAccumPath, windowHours);
        tempPaths.push(baked.gribPath);
        if (variable.gfs!.accumulated) prevAccumPath = baked.gribPath;
        prevFhr = fhr;

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
          throw new Error(`texture create failed for ${variable.id} f${fhr}`);
        }
        entry.files[String(fhr)] = tex.data.id;
        dbg(TAG, `baked ${variable.id} f${fhr}`, { bytes: baked.buffer.byteLength });
      } catch (fhrErr) {
        fhrErrors.push({ fhr, err: String(fhrErr) });
        dbg(TAG, `fhr skipped ${variable.id} f${fhr}`, { err: String(fhrErr) });
      }
    }

    const bakedCount = Object.keys(entry.files).length;
    const vms = Date.now() - vStart;
    if (bakedCount > 0) {
      if (fhrErrors.length > 0) degraded.push({ variable: variable.id, missing: fhrErrors.map((f) => f.fhr) });
      log(TAG, `ingest: ${variable.id} baked ${bakedCount}/${bakedFhrs.length} hrs in ${vms}ms — publishing`, {
        variable: variable.id,
        baked: bakedCount,
        skippedHrs: fhrErrors.length,
        ms: vms,
        ...(fhrErrors.length > 0 ? { missing: fhrErrors.map((f) => f.fhr) } : {}),
      });
      // PUBLISH THIS MAP NOW — don't wait for the rest of the run.
      await publishVariable(variable, entry);
    } else {
      const why = fhrErrors[0]?.err ?? "no hours produced";
      log(TAG, `ingest: ${variable.id} FAILED (0/${bakedFhrs.length} hrs) in ${vms}ms — ${why}`, {
        variable: variable.id,
        err: why,
        ms: vms,
      });
      skipped.push({ variable: variable.id, err: why });
      await db.weatherTextures.deleteMany({ runId, variable: variable.id }).catch(() => {});
    }
  };

  try {
    await withConcurrency(gfsVars, BAKE_CONCURRENCY, bakeOneVariable);
    await publishChain; // ensure every incremental publish has flushed

    if (runVanished) {
      throw new Error(
        `ingest: run doc ${runId} vanished mid-bake (deleted by a concurrent clear/retention)`,
      );
    }

    if (Object.keys(publishedVars).length === 0) {
      // Nothing baked — almost always one root cause across every field (source
      // unreachable, throttle/outage, wgrib2 missing), so the first few say it all.
      const sample = skipped.slice(0, 3).map((s) => `${s.variable}: ${s.err}`).join(" | ");
      blogErr(
        TAG,
        `ingest failed: 0/${gfsVars.length} vars baked (every field failed) — ` +
          `likely source throttling/outage. ${sample}`,
        new Error(sample || "all fields failed"),
        "weather",
        "ingest",
      );
      throw new Error(
        `ingest: no variables baked (all ${skipped.length} fields failed)` + (sample ? ` — ${sample}` : ""),
      );
    }

    // Finalise: mark complete and re-stamp generatedAt to the completion time
    // (already published incrementally; this just closes the run out).
    await db.weatherRuns.updateByID(runId, {
      status: "complete",
      generatedAt: new Date(),
      published: true,
    });
    await bustManifestCache();

    const okCount = Object.keys(publishedVars).length;
    const ms = Date.now() - startedAt;
    if (skipped.length > 0 || degraded.length > 0) {
      blogWarn(
        TAG,
        `ingest published gfs ${date}/${cycle}z: ${okCount}/${gfsVars.length} vars` +
          (skipped.length ? `, ${skipped.length} dropped` : "") +
          (degraded.length ? `, ${degraded.length} with gaps` : "") +
          ` (${ms}ms)`,
        {
          run: runDate.toISOString(),
          baked: okCount,
          dropped: skipped.map((s) => s.variable),
          degraded: degraded.map((d) => ({ variable: d.variable, missing: d.missing })),
          ms,
        },
        "weather",
        "ingest",
      );
    } else {
      blogInfo(
        TAG,
        `ingest published gfs ${date}/${cycle}z: ${okCount} vars (${ms}ms)`,
        { run: runDate.toISOString(), baked: okCount, ms },
        "weather",
        "ingest",
      );
    }

    await runRetention(db as any, retainRuns);

    // Long-term + rolling-forecast archives. Never fail the (already published) run.
    const archiveArgs = {
      id: runId,
      model,
      run: runDate,
      bounds: [...GFS_BOUNDS],
      grid: { ...GFS_GRID },
      steps,
      variables: publishedVars,
    };
    await archiveRun(db as any, archiveArgs).catch((ex) => log(TAG, "ingest: archive failed", { err: String(ex) }));
    await archiveForecastRun(db as any, archiveArgs).catch((ex) =>
      log(TAG, "ingest: forecast archive failed", { err: String(ex) }),
    );

    log(TAG, "ingest: published", { run: runDate.toISOString(), runId, baked: okCount });
    return { published: true, run: runDate.toISOString(), runId, baked: okCount };
  } catch (ex) {
    if (runVanished) {
      // The run doc is already gone — just sweep the orphan textures we baked.
      log(TAG, "ingest: run doc vanished mid-bake, cleaning orphan textures", { runId });
      await db.weatherTextures.deleteMany({ runId }).catch(() => {});
    } else if (Object.keys(publishedVars).length === 0) {
      // Roll back when NOTHING good was published.
      log(TAG, "ingest: failed with no published variables, marking run failed", { runId });
      await db.weatherRuns.updateByID(runId, { status: "failed", published: false }).catch(() => {});
      await db.weatherTextures.deleteMany({ runId }).catch(() => {});
    } else {
      // A partial run that already put maps on air must survive (progressive
      // publish is the whole point).
      log(TAG, "ingest: error after partial publish — keeping the published run", {
        runId,
        published: Object.keys(publishedVars).length,
        err: String(ex),
      });
    }
    throw ex;
  } finally {
    for (const p of tempPaths) await cleanupTemp(p);
  }
}
