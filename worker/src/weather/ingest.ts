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
import { cfg, bakeSteps, runDateFor } from "./config";
import { bakeVariableStep } from "./bakeVariableStep";
import { blogInfo, blogWarn, blogErr } from "../blog";
import { dbg } from "./debug";
import { bustManifestCache } from "./manifestCache";
import { recentPendingRun } from "./inflight";

const TAG = "job:weather";

/**
 * Ingest a full run: create a pending WeatherRun, bake every variable at every
 * forecast step, persist textures, then atomically publish (published flips
 * LAST). Idempotent on model+run. If any bake fails the run is marked failed and
 * never published.
 */
export async function runIngest(job: Job) {
  const config = cfg();
  const { model, stepHours, retainRuns } = config;
  const data = job.data?.data ?? {};
  const date: string = data.date;
  const cycle: string = data.cycle;
  // `force` (the "Remake weather" button) rebakes even an already-published
  // cycle: it bakes a FRESH run doc while the old one stays live, and the atomic
  // publish + retention swap it in — so the map never blanks. A normal check-
  // driven ingest keeps its idempotency skip (no needless double-bake).
  const force: boolean = !!data.force;
  if (!date || !cycle) throw new Error("ingest: missing date/cycle");

  const db = await getAppDb();
  const runDate = runDateFor(date, cycle);

  // Concurrency guard (applies even to force): never bake the same cycle twice at
  // once. If another ingest for this exact model+cycle is already in flight (a
  // recent pending run doc), skip — this is the hard backstop against duplicate
  // `weather.ingest` jobs racing (the check-side guard is best-effort; two jobs
  // can still slip through the enqueue window). A stale pending doc (crashed
  // bake) is ignored by `recentPendingRun`, so a dead run can't wedge the queue.
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
    `ingest start: gfs ${date}/${cycle}z — ${gfsVars.length} vars × ${steps.length} steps`,
    { date, cycle, vars: gfsVars.length, steps: steps.length },
    "weather",
    "ingest",
  );

  try {
    const variables: Record<string, iWeatherVariableEntry> = {};
    // A variable that produced NO usable hour, with why — so a total wipe-out
    // surfaces its cause (the plain `log` below only reaches stdout, not the
    // admin blog); the summary + thrown error then carry the real reason
    // (e.g. "download failed 302" = NOMADS throttling, "404" = tail not posted).
    const skipped: Array<{ variable: string; err: string }> = [];
    // A variable that published but is missing some forecast hours.
    const degraded: Array<{ variable: string; missing: number[] }> = [];

    let vi = 0;
    for (const variable of gfsVars) {
      vi += 1;
      const vStart = Date.now();
      // Always-on progress so a slow ingest shows a live heartbeat in the logs
      // (each variable is ~50 forecast-hour downloads + bakes).
      log(TAG, `ingest: baking ${variable.id} (${vi}/${gfsVars.length})`, {
        run: runDate.toISOString(),
        steps: bakedFhrs.length,
      });

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
        // Each forecast hour is independent: a single missing/failed step (a
        // not-yet-posted tail hour like f336, or one throttled download) skips
        // ONLY that hour — it must NOT discard the whole variable and the good
        // hours already baked (the bug that turned one f336 404 into a total
        // "no variables baked" wipe-out).
        try {
          // Accumulated fields (precip) diff against the previous baked step, so
          // the window is the actual gap between steps (3h in the detailed track,
          // 12h across the daily-outlook tail) — widening correctly across any
          // skipped hour since prevFhr only advances on success.
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
        variables[variable.id] = entry;
        if (fhrErrors.length > 0) degraded.push({ variable: variable.id, missing: fhrErrors.map((f) => f.fhr) });
        log(TAG, `ingest: ${variable.id} baked ${bakedCount}/${bakedFhrs.length} hrs in ${vms}ms`, {
          variable: variable.id,
          baked: bakedCount,
          skippedHrs: fhrErrors.length,
          ms: vms,
          ...(fhrErrors.length > 0 ? { missing: fhrErrors.map((f) => f.fhr) } : {}),
        });
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
    }

    if (Object.keys(variables).length === 0) {
      // Surface a representative sample of the underlying failures — almost
      // always the same root cause across every variable (source unreachable,
      // NOMADS 302 throttle / 403 block, wgrib2 missing), so the first few say
      // it all. Blogged (admin/logs) AND thrown (the thrown message reaches the
      // job-failure log too, but the blog carries the structured breakdown).
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
        `ingest: no variables baked (all ${skipped.length} fields failed)` +
          (sample ? ` — ${sample}` : ""),
      );
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
    // Drop the manifest cache so the map picks up this run now, not in ≤10 min.
    await bustManifestCache();

    // Lifecycle summary in /admin/logs: green when whole, warn when any variable
    // was dropped or came in with gaps (still published, just degraded).
    const okCount = Object.keys(variables).length;
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
