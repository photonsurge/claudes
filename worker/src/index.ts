// index.ts
// Worker entrypoint and BullMQ consumer. Boots the process: loads env, connects
// the socket client + Mongo, auto-discovers job handlers from src/jobs/*.ts
// (handlers[type][event]), starts the BullMQ Worker that routes each job to its
// handler, registers the repeatable weather.check + alerts.ingest schedulers, and
// serves health/status HTTP probes. This is the long-running background service.
import { loadWorkerEnv } from "./loadEnv";
loadWorkerEnv();

import express from "express";
import http from "http";
import { Worker, Job } from "bullmq";
import { readdirSync } from "fs";
import { join, extname, basename } from "path";
import v8 from "v8";

import { QUEUE_NAMES, QUEUE_TIERS, TIER_CONCURRENCY, queueForType } from "@photonsurge/shared/utill/bull-utils";
import { getQueue, getAllQueues, getRedisOptions } from "@photonsurge/shared/bull/bull";
import { bakePoolStats } from "./grib/bakePool";
import { getDb, closeDb } from "@photonsurge/shared/utill/mongoose";
import { getAppDb } from "@photonsurge/shared/db/index";
import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";
import { jobLabel } from "@photonsurge/shared/jobs";
import { WorkerBackLogger } from "@photonsurge/shared/utill/BackLogger";

import { initSocket, closeSocket } from "./socket";
import { startQueueEventBridge } from "./queueEventBridge";
import { installJobConsoleTap, runInJobLogContext } from "./jobLog";
import { beginJob, endJob, startCancelSubscriber, activeJobLabels } from "./jobCancel";
import { startDirector, stopDirector } from "./director/loop";
import { WEATHER_SOURCE_JOBS, jobEveryMs } from "./weather/sourceSchedule";
import { getEnabledSources } from "./alerts/registry";
import { getEnabledCamSources } from "./cams/registry";
import { summarizeForLog } from "./utils";
import {
  samplePointHistory,
  sampleAreaHistory,
  sampleForecastPoint,
  sampleForecastArea,
} from "./weather/sampleService";
import packageJson from "../package.json";

const TAG = "worker";
const PORT = Number(process.env.PORT || 8080);

// De-sync the repeatable jobs. A BullMQ `every` schedule with no `offset`
// anchors its phase to when it was first registered — so every job registered
// in this boot loop lands on the SAME clock grid and they all fire together
// (and, per BullMQ, `immediately:true` on an `every` job is a no-op that just
// means "delay 0" — i.e. the whole fleet also stampedes at boot). Giving each
// job a stable per-jobId `offset` phase-shifts it off that shared grid so the
// load spreads out instead of spiking. Capped so even a daily catalog job still
// first-runs within JOB_STAGGER_MS of boot (seeding stays prompt); the spread
// window is min(interval, cap). Deterministic (FNV-1a on the jobId) so a job
// keeps the same phase across restarts and BullMQ doesn't churn the schedule.
const MAX_STAGGER_MS = Number(process.env.JOB_STAGGER_MS || 4 * 60 * 1000);
function fnv(jobId: string): number {
  let h = 2166136261;
  for (let i = 0; i < jobId.length; i++) {
    h ^= jobId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function staggerOffset(jobId: string, everyMs: number): number {
  const span = Math.min(everyMs, MAX_STAGGER_MS);
  if (span <= 0) return 0;
  return fnv(jobId) % span;
}
/**
 * Deterministic minute in [lo, hi] for OUR default cron patterns, so the cron
 * registrations don't all sit on :00 alongside each other (the every-based jobs
 * are phase-staggered via startDate; the crons were the remaining top-of-hour
 * pack). Only shifts in-code defaults — an env-supplied cron passes through
 * verbatim.
 */
const staggerMinute = (jobId: string, lo: number, hi: number): number => lo + (fnv(jobId) % (hi - lo + 1));

const waitForMongo = async () => {
  const MAX_ATTEMPTS = 30;
  const DELAY_MS = 2000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const conn = await getDb();
      await conn.db?.admin().ping();
      log(TAG, `waitForMongo: ready (attempt ${attempt})`);
      return;
    } catch {
      log(TAG, `waitForMongo: not ready (${attempt}/${MAX_ATTEMPTS}) — retrying in ${DELAY_MS}ms`);
      if (attempt === MAX_ATTEMPTS) throw new Error(`MongoDB not available after ${MAX_ATTEMPTS} attempts`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
};

process.on("unhandledRejection", (reason) => console.error("[worker] unhandledRejection:", reason));
process.on("uncaughtException", (err) => {
  console.error("[worker] uncaughtException:", err);
  process.exit(1);
});

(async () => {
  // Producing side: every tier's queue, plus a router that sends each job to the
  // queue its TYPE belongs to. `addJob` mirrors `queue.add(name, payload, opts)`
  // exactly — only the target queue changes — so the registrations below read as
  // before while tiering themselves (bull-utils#queueForType).
  const queues = getAllQueues().map((q) => q.queue);
  // Every scheduler-registered job retries transient failures. Without this a
  // repeatable runs attempts 1/0 — one Docker-DNS blip (EAI_AGAIN mongodb, seen
  // at staging boot) fails the whole tick outright instead of retrying 5s later.
  const JOB_DEFAULTS = { attempts: 3, backoff: { type: "exponential", delay: 5_000 } } as const;

  /**
   * Register work on the tier its type belongs to. One-shots go straight to the
   * queue; repeatables become BullMQ v5 JOB SCHEDULERS, not legacy `repeat` jobs.
   *
   * Why: the legacy path DROPS a caller `offset` the first time an iteration
   * re-arms — its persisted config is only {name,endDate,tz,pattern,every} — so
   * every short-cadence job collapsed back onto the wall-clock grid within one
   * cycle and the whole fleet detonated together at :00 (the top-of-hour heap
   * OOM on the 8GB staging host; verified live: re-armed jobs all showed
   * storedOffset null / slot+0). A job scheduler persists its phase, so we
   * anchor `startDate` at the next grid slot + the job's deterministic stagger
   * and BullMQ keeps that phase for every iteration thereafter.
   *
   * `immediately` (forbidden alongside startDate) becomes an explicit one-shot
   * kick — the same idempotent-seed semantic the weather fleet already uses.
   */
  const addJob = async (name: string, payload: { type: string; [k: string]: any }, opts?: any) => {
    const q = getQueue(queueForType(payload.type));
    const { repeat, jobId, ...rest } = opts ?? {};
    if (!repeat) return q.add(name, payload, { ...JOB_DEFAULTS, ...rest });

    const schedulerId = jobId ?? `${payload.type}-${payload.event}`;
    const template = { name, data: payload, opts: { ...JOB_DEFAULTS, ...rest } };
    if (repeat.pattern) {
      await q.upsertJobScheduler(schedulerId, { pattern: repeat.pattern, tz: repeat.tz }, template);
    } else {
      const every = Number(repeat.every);
      const phase = Number(repeat.offset) || 0; // staggerOffset / explicit spacing
      const now = Date.now();
      const slot = Math.floor(now / every) * every + phase;
      const startDate = slot > now ? slot : slot + every;
      await q.upsertJobScheduler(schedulerId, { every, startDate }, template);
      if (repeat.immediately) {
        await q.add(name, payload, { ...JOB_DEFAULTS, ...rest, removeOnComplete: true, removeOnFail: true });
      }
    }
  };
  await initSocket();

  // Relay BullMQ lifecycle events up to the socket server so /admin/queue can
  // show a live console of jobs as they happen (see queueEventBridge.ts). These
  // fan out to every connected browser, so allow silencing with an env flag.
  const stopQueueEventBridge =
    process.env.QUEUE_EVENT_STREAM_ENABLED !== "false" ? startQueueEventBridge() : () => {};

  // Stream each job's own console output to /admin/queue (queue:log), scoped to
  // the running job — so you can watch what a long-running job is doing. Patches
  // global console.*, so it has its own opt-out.
  const stopJobConsoleTap =
    process.env.QUEUE_JOB_LOG_STREAM_ENABLED !== "false" ? installJobConsoleTap() : () => {};

  // Listen for operator "cancel job" requests (published by /admin/queue) and
  // cooperatively abort the matching active job (see jobCancel.ts).
  const stopCancelSubscriber = await startCancelSubscriber().catch((err) => {
    log(TAG, "cancel subscriber failed to start", summarizeForLog(err));
    return () => {};
  });

  // Auto-discover job handlers: handlers[type][event] -> fn(job)
  const handlers: Record<string, Record<string, any>> = {};
  const jobsDir = join(__dirname, "jobs");

  const loadHandlers = async () => {
    const registered: string[] = [];
    const files = readdirSync(jobsDir).filter(
      (f) =>
        (extname(f) === ".ts" || extname(f) === ".js") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".test.js") &&
        !f.endsWith(".d.ts"),
    );

    for (const file of files) {
      const name = basename(file).replace(/\.(ts|js)$/, "");
      const mod = await import(join(jobsDir, file));
      const fns: Record<string, any> = {};
      for (const key of Object.keys(mod)) {
        if (typeof mod[key] === "function") {
          fns[key] = mod[key];
          registered.push(`${name}.${key}`);
        }
      }
      handlers[name] = fns;
    }
    return registered;
  };

  await waitForMongo();
  const registered = await loadHandlers();
  log(TAG, `registered handlers`, registered);

  // Auto-director: a self-running camera/sequencer per scene that's in "auto"
  // mode. Runs in-process (not a BullMQ job) — reads Mongo + emits director:state.
  startDirector();

  // Per-job memory instrumentation. A slow OOM used to only announce itself as a
  // 4GB heap-limit crash mid weather-refresh; logging heap/rss around every job —
  // plus the process rss high-water — turns the next spike into "job X left rss at
  // Y" instead of a core dump. Cheap (a memoryUsage() read per job).
  const mb = (b: number) => Math.round(b / 1048576);
  let rssHighWater = 0;

  // Per-event usage ledger — so "which job type eats memory / runs long" is a table
  // you can read (via /status), not something you reconstruct from a crash. Keyed by
  // the job label (type.event, or type.event:source), tracking run/error counts,
  // timing and the peak heap-delta + rss each event has ever been seen with.
  type EventStat = {
    runs: number;
    errors: number;
    totalMs: number;
    peakMs: number;
    lastMs: number;
    peakHeapDeltaMB: number;
    peakRssMB: number;
  };
  const eventStats = new Map<string, EventStat>();
  const bumpStat = (label: string, ms: number, heapDeltaMB: number, rssMB: number, ok: boolean) => {
    const s = eventStats.get(label) ?? {
      runs: 0,
      errors: 0,
      totalMs: 0,
      peakMs: 0,
      lastMs: 0,
      peakHeapDeltaMB: 0,
      peakRssMB: 0,
    };
    s.runs++;
    if (!ok) s.errors++;
    s.totalMs += ms;
    s.lastMs = ms;
    if (ms > s.peakMs) s.peakMs = ms;
    if (heapDeltaMB > s.peakHeapDeltaMB) s.peakHeapDeltaMB = heapDeltaMB;
    if (rssMB > s.peakRssMB) s.peakRssMB = rssMB;
    eventStats.set(label, s);
  };

  const processJob = async (job: Job) => {
    const type = typeof job.data?.type === "string" ? job.data.type : "unknown";
    const event = typeof job.data?.event === "string" ? job.data.event : "unknown";
    // Qualified with the source where there is one ("alerts.ingest:wmo"): alerts
    // registers a repeatable PER SOURCE, so the log showed four identical
    // `alerts.ingest` lines interleaved and you couldn't tell which feed was
    // slow — or whether one job was looping. See jobLabel.
    const label = jobLabel(job.data) ?? `${type}.${event}`;
    log(TAG, `job:start [${job.id}] ${label}`);
    const handler = handlers[type];
    if (!handler) throw new Error(`No handler for type: ${type}`);
    const fn = handler[event];
    if (!fn) throw new Error(`No handler for event: ${type}.${event}`);
    const jobId = String(job.id ?? "");
    const startedAt = Date.now();
    const heapBefore = process.memoryUsage().heapUsed;
    // Register the job so an operator cancel can cooperatively abort it.
    beginJob(jobId, job);
    try {
      // Run inside the job-log context so the handler's console output streams
      // to /admin/queue tagged with this job (see jobLog.ts).
      const result = await runInJobLogContext({ jobId, label }, () => fn(job));
      const ms = Date.now() - startedAt;
      const m = process.memoryUsage();
      if (m.rss > rssHighWater) rssHighWater = m.rss;
      const mem = { heapDeltaMB: mb(m.heapUsed - heapBefore), heapMB: mb(m.heapUsed), rssMB: mb(m.rss), rssPeakMB: mb(rssHighWater) };
      bumpStat(label, ms, mem.heapDeltaMB, mem.rssMB, true);
      log(TAG, `job:done  [${job.id}] ${label} (${ms}ms)`, mem);
      const detail = result && typeof result === "object" ? { ...result, ms, ...mem } : { result, ms, ...mem };
      WorkerBackLogger(TAG, "event", `job:${type}`, `${label} done in ${ms}ms`, detail, type, String(job.id ?? ""));
      return result;
    } catch (ex) {
      const ms = Date.now() - startedAt;
      bumpStat(label, ms, mb(process.memoryUsage().heapUsed - heapBefore), mb(process.memoryUsage().rss), false);
      log(TAG, `job:error [${job.id}] ${type}.${event} (${ms}ms)`, summarizeForLog(ex));
      WorkerBackLogger(TAG, "error", `job:${type}`, `${type}.${event} failed after ${ms}ms`, summarizeForLog(ex), type, String(job.id ?? ""));
      throw ex;
    } finally {
      endJob(jobId);
    }
  };

  // THREE queues, THREE workers — split by resource weight (bull-utils). The
  // background lane's low concurrency is the cap that bounds peak heap: heavy
  // weather bakes + reproject can no longer stack ten-deep in one 4GB heap and OOM.
  // Foreground (director, health) never queues behind a bake.
  //
  // lockDuration is the crux of the old "could not renew lock for job repeat:…" +
  // "Missing lock … moveToFinished code: -2" fan-out. BullMQ renews a job's lock
  // every lockDuration/2 on THIS event loop; a handler that blocks it past ~15s
  // (the alert dissolve's polygon union, full-grid bakes) missed the 30s-default
  // renewal and EVERY in-flight job dropped its lock at once. 300s renews at 150s.
  // The real fix is keeping CPU off the loop (dissolve → child process, bakes →
  // worker-thread pool); this stops the bleeding for whatever's left.
  // Effective per-tier concurrency (env override wins over the tuned default).
  // Exposed on /status too, so the health dashboard shows the REAL cap that's
  // bounding heap, not just the compiled-in default.
  const concurrencyFor = (tier: (typeof QUEUE_TIERS)[number]) =>
    Number(process.env[`WORKER_CONCURRENCY_${tier.toUpperCase()}`] || TIER_CONCURRENCY[tier]);
  const workerOptsFor = (tier: (typeof QUEUE_TIERS)[number]) => ({
    connection: { ...getRedisOptions(), maxRetriesPerRequest: null },
    concurrency: concurrencyFor(tier),
    lockDuration: Number(process.env.WORKER_LOCK_DURATION_MS || 300_000),
    stalledInterval: 30_000,
    maxStalledCount: 2,
  });
  const workers = QUEUE_TIERS.map((tier) => new Worker(QUEUE_NAMES[tier], processJob, workerOptsFor(tier)));
  log(TAG, `workers started`, Object.fromEntries(QUEUE_TIERS.map((t) => [t, workerOptsFor(t).concurrency])));

  // Clear stale schedules before re-registering, so the registrations below are
  // always authoritative — a job type removed from code must stop firing, and a
  // changed interval must not leave the old cadence running alongside the new.
  // Two generations coexist here: JOB SCHEDULERS (what addJob registers now) and
  // any LEGACY repeatables left by an older build (keyed by options, removed by
  // key). getRepeatableJobs() lists both, so remove schedulers first and only
  // legacy-remove what wasn't already a scheduler. Phases are deterministic
  // (staggerOffset hashes the jobId), so re-registering restores each job to
  // the SAME slot phase — clearing costs nothing but the re-upsert.
  try {
    let cleared = 0;
    for (const q of queues) {
      const schedulers = await q.getJobSchedulers(0, 5000);
      const schedKeys = new Set(schedulers.map((s) => String(s.key)));
      for (const key of schedKeys) await q.removeJobScheduler(key);
      const repeatables = await q.getRepeatableJobs();
      for (const r of repeatables) {
        if (schedKeys.has(String(r.key))) continue; // removed above with its scheduler
        await q.removeRepeatableByKey(r.key);
        cleared++;
      }
      cleared += schedKeys.size;
    }
    if (cleared) log(TAG, `cleared ${cleared} stale schedule(s)`);
  } catch (err) {
    log(TAG, `failed to clear stale schedules`, summarizeForLog(err));
  }

  // ALSO drop the not-yet-run jobs those old schedules had already promoted.
  // Removing a schedule leaves its pending iterations behind — and on a Redis
  // with downtime history, BullMQ then REPLAYS every missed slot back-to-back
  // (staging boot: three ~16-day-old summaries.generateHourly starts within
  // 70ms took the 2GB heap down in minutes). The registrations below re-arm
  // every schedule fresh, so a pending repeat-owned job is never real work —
  // only history about to be replayed. Regular one-shot jobs are untouched.
  // Paged, ids-first: a restored Redis can hold TENS OF THOUSANDS of pending
  // jobs, so a single getJobs(0,-1) would materialise every payload at once —
  // at boot, in the same heap the flood itself is about to attack. Scan a page
  // at a time, keep only the (tiny) ids of repeat-owned jobs, remove after.
  try {
    const PAGE = 500;
    let dropped = 0;
    for (const q of queues) {
      const ids: string[] = [];
      for (let start = 0; ; start += PAGE) {
        const page = await q.getJobs(["delayed", "waiting", "prioritized"] as any, start, start + PAGE - 1, false);
        for (const j of page) {
          if (String(j.id ?? "").startsWith("repeat:") || (j as any).repeatJobKey != null) ids.push(String(j.id));
        }
        if (page.length < PAGE) break;
      }
      for (const id of ids) {
        try {
          await q.remove(id);
          dropped++;
        } catch {
          /* already gone or just went active — the replay flood is bounded either way */
        }
      }
    }
    if (dropped) log(TAG, `dropped ${dropped} stale repeat iteration(s) (replay guard)`);
  } catch (err) {
    log(TAG, `failed to drop stale repeat iterations`, summarizeForLog(err));
  }

  // ---- Repeatable weather.check job (BullMQ, not node-cron) ----
  // Enqueues `{ type:"weather", event:"check" }` on RUN_CHECK_CRON. A fixed
  // jobId de-duplicates the repeat scheduler across restarts. The default is a
  // staggered half-hourly (:m and :m+30, m hashed 2-14) rather than :00/:30 —
  // it's an availability POLL, so nothing about it needs the top of the hour,
  // and :00 is exactly where the rest of the fleet used to pile up. The +443MB
  // it costs on real data now lands on a quiet minute.
  const RUN_CHECK_CRON =
    process.env.RUN_CHECK_CRON || `${staggerMinute("weather-check", 2, 14)}-59/30 * * * *`;
  try {
    await addJob(
      "do",
      { domain: "weather", type: "weather", event: "check", data: {} },
      { repeat: { pattern: RUN_CHECK_CRON }, jobId: "weather-check" },
    );
    log(TAG, `registered repeatable weather.check`, RUN_CHECK_CRON);
  } catch (err) {
    log(TAG, `failed to register weather.check`, summarizeForLog(err));
  }

  // ---- Repeatable multi-supplier ingests (IFS / RTOFS / GFS-Wave mosaic) ----
  // Each handler is idempotent (skips if that model+run is already published), so
  // polling frequently just re-checks availability without re-baking or hammering
  // upstream. NOMADS fetches are throttled process-wide by nomadsGate(). Disable
  // the whole group with MULTISOURCE_INGEST_ENABLED=false. Per-source cadence env-
  // tunable; defaults suit each product's refresh (IFS/wave 6-hourly, RTOFS daily).
  if (process.env.MULTISOURCE_INGEST_ENABLED !== "false") {
    // The ingest fleet lives in one shared list (weather/sourceSchedule.ts) so the
    // reset script re-kicks exactly what the scheduler registers — no drift.
    // Only schedule ENABLED sources (IFS is off by default until CCSDS-validated).
    for (const job of WEATHER_SOURCE_JOBS.filter((j) => getSource(j.sourceId)?.enabled)) {
      const { event } = job;
      const every = jobEveryMs(job);
      try {
        await addJob(
          "do",
          { domain: "weather", type: "weather", event, data: {} },
          { repeat: { every, offset: staggerOffset(`weather-${event}`, every) }, jobId: `weather-${event}` },
        );
        // BullMQ `repeat: { every }` only fires the FIRST run one interval later,
        // so a fresh worker would sit empty for up to `every` ms. Kick each ingest
        // ONCE at boot so everything auto-populates immediately (then the repeat
        // takes over). Idempotent (alreadyPublished skips) + nomadsGate-throttled,
        // so it just re-checks availability. Disable with WEATHER_INGEST_ON_BOOT=false.
        if (process.env.WEATHER_INGEST_ON_BOOT !== "false") {
          await addJob(
            "do",
            { domain: "weather", type: "weather", event, data: {} },
            { removeOnComplete: true, removeOnFail: true },
          );
        }
        log(TAG, `registered repeatable weather.${event}`, { every });
      } catch (err) {
        log(TAG, `failed to register weather.${event}`, { err: summarizeForLog(err) });
      }
    }
  }

  // ---- Repeatable alerts.ingest jobs (one per enabled source) ----
  // Each source polls on its own pollIntervalSec; a fixed jobId per source
  // de-duplicates the repeat scheduler across restarts (spec §6).
  for (const source of getEnabledSources()) {
    try {
      await addJob(
        "do",
        { domain: "alerts", type: "alerts", event: "ingest", data: { source: source.id } },
        {
          repeat: {
            every: source.pollIntervalSec * 1000,
            offset: staggerOffset(`alerts-${source.id}`, source.pollIntervalSec * 1000),
          },
          jobId: `alerts-${source.id}`,
        },
      );
      log(TAG, `registered repeatable alerts.ingest`, { source: source.id, every: source.pollIntervalSec });
    } catch (err) {
      log(TAG, `failed to register alerts.ingest`, { source: source.id, err: summarizeForLog(err) });
    }
  }

  // ---- Repeatable alerts.reconcile job ----
  // The stored-data sweeps (green retirement, rank resync, event lifecycle).
  // ONCE, not per source: these are global, and living inside the per-source
  // `alerts.ingest` meant every one ran three times over, concurrently, with the
  // GDACS tick re-ranking MeteoAlarm's awareness levels. Idempotent and cheap in
  // the steady state, so the cadence only bounds how long a stale record can
  // linger, not how much work happens.
  const ALERTS_RECONCILE_MS = Number(process.env.ALERTS_RECONCILE_MS || 5 * 60 * 1000);
  try {
    await addJob(
      "do",
      { domain: "alerts", type: "alerts", event: "reconcile", data: {} },
      {
        repeat: { every: ALERTS_RECONCILE_MS, offset: staggerOffset("alerts-reconcile", ALERTS_RECONCILE_MS) },
        jobId: "alerts-reconcile",
      },
    );
    log(TAG, `registered repeatable alerts.reconcile`, { every: ALERTS_RECONCILE_MS });
  } catch (err) {
    log(TAG, `failed to register alerts.reconcile`, { err: summarizeForLog(err) });
  }

  // ---- Repeatable alerts.translate job ----
  // Own cadence, decoupled from ingest, so a slow LLM call never blocks the poll
  // tick. No-ops (never touches Mongo) when OPENROUTER_API_KEY is unset.
  const ALERTS_TRANSLATE_MS = Number(process.env.ALERTS_TRANSLATE_MS || 15 * 60 * 1000);
  try {
    await addJob(
      "do",
      { domain: "alerts", type: "alerts", event: "translate", data: {} },
      {
        repeat: { every: ALERTS_TRANSLATE_MS, offset: staggerOffset("alerts-translate", ALERTS_TRANSLATE_MS) },
        jobId: "alerts-translate",
      },
    );
    log(TAG, `registered repeatable alerts.translate`, { every: ALERTS_TRANSLATE_MS });
  } catch (err) {
    log(TAG, `failed to register alerts.translate`, { err: summarizeForLog(err) });
  }

  // ---- Repeatable alerts.snapshotSatellite job (hourly) ----
  // Bake a GIBS satellite still over each interesting active alert's bbox. Onset
  // one-shots (an alert escalating to severe+) are enqueued from alerts.ingest;
  // this is the steady hourly refresh. Opt-out via ALERT_SNAPSHOT_ENABLED=false
  // (matches jobs/alerts.ts#alertSnapshotEnabled).
  if (process.env.ALERT_SNAPSHOT_ENABLED !== "false") {
    const ALERT_SNAPSHOT_MS = Number(process.env.ALERT_SNAPSHOT_MS || 60 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "alerts", type: "alerts", event: "snapshotSatellite", data: {} },
        {
          repeat: { every: ALERT_SNAPSHOT_MS, offset: staggerOffset("alerts-snapshot-satellite", ALERT_SNAPSHOT_MS) },
          jobId: "alerts-snapshot-satellite",
        },
      );
      log(TAG, `registered repeatable alerts.snapshotSatellite`, { every: ALERT_SNAPSHOT_MS });
    } catch (err) {
      log(TAG, `failed to register alerts.snapshotSatellite`, { err: summarizeForLog(err) });
    }

    // Side-by-side "then vs now" comparison, offset from the satellite bake so it
    // runs once fresh frames exist.
    const ALERT_COMPARE_MS = Number(process.env.ALERT_COMPARE_MS || 60 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "alerts", type: "alerts", event: "snapshotCompare", data: {} },
        {
          repeat: { every: ALERT_COMPARE_MS, offset: staggerOffset("alerts-snapshot-compare", ALERT_COMPARE_MS) },
          jobId: "alerts-snapshot-compare",
        },
      );
      log(TAG, `registered repeatable alerts.snapshotCompare`, { every: ALERT_COMPARE_MS });
    } catch (err) {
      log(TAG, `failed to register alerts.snapshotCompare`, { err: summarizeForLog(err) });
    }

    // Nearby-camera stills — opt-in (fetches + stores third-party images).
    if (process.env.ALERT_CAMERA_SNAPSHOT_ENABLED === "true") {
      const ALERT_CAMERA_MS = Number(process.env.ALERT_CAMERA_MS || 60 * 60 * 1000);
      try {
        await addJob(
          "do",
          { domain: "alerts", type: "alerts", event: "snapshotCameras", data: {} },
          {
            repeat: { every: ALERT_CAMERA_MS, offset: staggerOffset("alerts-snapshot-cameras", ALERT_CAMERA_MS) },
            jobId: "alerts-snapshot-cameras",
          },
        );
        log(TAG, `registered repeatable alerts.snapshotCameras`, { every: ALERT_CAMERA_MS });
      } catch (err) {
        log(TAG, `failed to register alerts.snapshotCameras`, { err: summarizeForLog(err) });
      }
    }
  }

  // ---- Repeatable events.watch sweeper (unified event acquisition) ----
  // ONE sweeper reads the per-event schedules whose nextCheckAt is due and fans
  // out an `acquire` per event (deep-GDACS + later ReliefWeb/Copernicus/EONET).
  // Per-event cadence lives in Mongo (event_watch_schedules), so a burst of events
  // never spawns a repeatable each. Opt-IN via EVENTS_UNIFIED_ENABLED=true so the
  // whole unified layer lands dark until switched on.
  if (process.env.EVENTS_UNIFIED_ENABLED === "true") {
    const EVENTS_WATCH_TICK_MS = Number(process.env.EVENTS_WATCH_TICK_MS || 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "events", type: "events", event: "watch", data: {} },
        {
          repeat: { every: EVENTS_WATCH_TICK_MS, offset: staggerOffset("events-watch", EVENTS_WATCH_TICK_MS) },
          jobId: "events-watch",
        },
      );
      log(TAG, `registered repeatable events.watch`, { every: EVENTS_WATCH_TICK_MS });
    } catch (err) {
      log(TAG, `failed to register events.watch`, { err: summarizeForLog(err) });
    }
  }

  // ---- Repeatable cams.ingest jobs (one per enabled camera source) ----
  // Each source polls its provider on its own pollIntervalSec and upserts the
  // canonical catalog into Mongo; the public app reads only that cache. A fixed
  // jobId per source de-dups the scheduler across restarts (mirrors alerts).
  // `immediately` seeds the catalog at boot so a fresh DB shows cams right away.
  // Sources self-disable when prerequisites are missing (e.g. no Windy key).
  if (process.env.CAMS_INGEST_ENABLED !== "false") {
    for (const source of getEnabledCamSources()) {
      try {
        await addJob(
          "do",
          { domain: "cams", type: "cams", event: "ingest", data: { source: source.id } },
          {
            repeat: {
              every: source.pollIntervalSec * 1000,
              immediately: true,
              offset: staggerOffset(`cams-${source.id}`, source.pollIntervalSec * 1000),
            },
            jobId: `cams-${source.id}`,
          },
        );
        log(TAG, `registered repeatable cams.ingest`, { source: source.id, every: source.pollIntervalSec });
      } catch (err) {
        log(TAG, `failed to register cams.ingest`, { source: source.id, err: summarizeForLog(err) });
      }
    }
  }

  // ---- Repeatable tracks.ingestTles (satellite TLEs → Mongo) ----
  // TLEs change slowly; refresh twice a day. A fixed jobId de-dups the scheduler.
  // `immediately` seeds the cache on startup — the public app reads Mongo only, so
  // without this a fresh worker leaves satellite groups empty for up to TLE_INGEST_MS.
  const TLE_INGEST_MS = Number(process.env.TLE_INGEST_MS || 12 * 60 * 60 * 1000);
  try {
    await addJob(
      "do",
      { domain: "tracks", type: "tracks", event: "ingestTles", data: {} },
      {
        repeat: { every: TLE_INGEST_MS, immediately: true, offset: staggerOffset("tracks-tles", TLE_INGEST_MS) },
        jobId: "tracks-tles",
      },
    );
    log(TAG, `registered repeatable tracks.ingestTles`, { everyMs: TLE_INGEST_MS });
  } catch (err) {
    log(TAG, `failed to register tracks.ingestTles`, summarizeForLog(err));
  }

  // ---- Repeatable tracks.snapshot{Aircraft,Ships} (the live cache) ----
  // The worker owns all upstream calls; the public routes read only the newest
  // frame from Mongo. Aircraft refresh faster than ships (they move faster); the
  // client dead-reckons between frames so these cadences still look live. Set
  // TRACK_SNAPSHOTS_ENABLED=false to disable polling external feeds entirely.
  if (process.env.TRACK_SNAPSHOTS_ENABLED !== "false") {
    const AIRCRAFT_SNAPSHOT_MS = Number(process.env.AIRCRAFT_SNAPSHOT_MS || 60 * 1000);
    // 6min interval gives the 5min AIS collection window (SHIP_COLLECT_MS) room
    // to finish before the next run. Both env-tunable for wider coverage.
    const SHIP_SNAPSHOT_MS = Number(process.env.SHIP_SNAPSHOT_MS || 360 * 1000);
    try {
      // immediately: run one snapshot at boot so a restart shows fresh data
      // without waiting out a full interval (esp. the 6min ship cadence).
      await addJob(
        "do",
        { domain: "tracks", type: "tracks", event: "snapshotAircraft", data: {} },
        {
          repeat: {
            every: AIRCRAFT_SNAPSHOT_MS,
            immediately: true,
            offset: staggerOffset("tracks-snapshot-aircraft", AIRCRAFT_SNAPSHOT_MS),
          },
          jobId: "tracks-snapshot-aircraft",
        },
      );
      await addJob(
        "do",
        { domain: "tracks", type: "tracks", event: "snapshotShips", data: {} },
        {
          repeat: {
            every: SHIP_SNAPSHOT_MS,
            immediately: true,
            offset: staggerOffset("tracks-snapshot-ships", SHIP_SNAPSHOT_MS),
          },
          jobId: "tracks-snapshot-ships",
        },
      );
      // Progressively fill the keyless hexdb aircraft-metadata cache.
      await addJob(
        "do",
        { domain: "tracks", type: "tracks", event: "enrichAircraft", data: {} },
        {
          repeat: {
            every: Number(process.env.AIRCRAFT_ENRICH_MS || 60_000),
            immediately: true,
            offset: staggerOffset("tracks-enrich-aircraft", Number(process.env.AIRCRAFT_ENRICH_MS || 60_000)),
          },
          jobId: "tracks-enrich-aircraft",
        },
      );
      // Cache photo + blurb onto the notable-tracks catalog. LOW PRIORITY (>0 so
      // it never competes with the live snapshots) and slow (staleness-gated +
      // a tiny catalog), so it barely touches the keyless services.
      await addJob(
        "do",
        { domain: "notable", type: "notable", event: "enrichNotable", data: {} },
        {
          repeat: {
            every: Number(process.env.NOTABLE_ENRICH_MS || 3_600_000),
            immediately: true,
            offset: staggerOffset("notable-enrich", Number(process.env.NOTABLE_ENRICH_MS || 3_600_000)),
          },
          jobId: "notable-enrich",
          priority: 10,
        },
      );
      log(TAG, `registered repeatable tracks.snapshot`, {
        aircraftMs: AIRCRAFT_SNAPSHOT_MS,
        shipMs: SHIP_SNAPSHOT_MS,
      });
    } catch (err) {
      log(TAG, `failed to register tracks.snapshot`, summarizeForLog(err));
    }

    // Earthquakes change far slower than vehicles — USGS revises events over
    // minutes. Poll every 5 min by default (SEISMIC_SNAPSHOT_MS to tune).
    const SEISMIC_SNAPSHOT_MS = Number(process.env.SEISMIC_SNAPSHOT_MS || 5 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "tracks", type: "tracks", event: "snapshotSeismic", data: {} },
        {
          repeat: { every: SEISMIC_SNAPSHOT_MS, offset: staggerOffset("tracks-snapshot-seismic", SEISMIC_SNAPSHOT_MS) },
          jobId: "tracks-snapshot-seismic",
        },
      );
      log(TAG, `registered repeatable tracks.snapshotSeismic`, { everyMs: SEISMIC_SNAPSHOT_MS });
    } catch (err) {
      log(TAG, `failed to register tracks.snapshotSeismic`, summarizeForLog(err));
    }
  }

  // ---- Repeatable cables.refresh (submarine fiber map → Mongo) ----
  // TeleGeography's cable dataset is near-static; refresh weekly by default. Runs
  // independently of live-track polling. A fixed jobId de-dups across restarts;
  // `immediately` seeds the cache at boot so a fresh DB shows cables right away.
  if (process.env.CABLE_REFRESH_ENABLED !== "false") {
    const CABLE_REFRESH_MS = Number(process.env.CABLE_REFRESH_MS || 7 * 24 * 60 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "cables", type: "cables", event: "refresh", data: {} },
        {
          repeat: { every: CABLE_REFRESH_MS, immediately: true, offset: staggerOffset("cables-refresh", CABLE_REFRESH_MS) },
          jobId: "cables-refresh",
        },
      );
      log(TAG, `registered repeatable cables.refresh`, { everyMs: CABLE_REFRESH_MS });
    } catch (err) {
      log(TAG, `failed to register cables.refresh`, summarizeForLog(err));
    }
  }

  // ---- Repeatable faults.refresh (tectonic plate boundaries → Mongo) ----
  // Bird's PB2002 boundaries are effectively fixed; refresh monthly by default.
  // A fixed jobId de-dups across restarts; `immediately` seeds the cache at boot
  // so a fresh DB shows plate boundaries right away.
  if (process.env.FAULT_REFRESH_ENABLED !== "false") {
    const FAULT_REFRESH_MS = Number(process.env.FAULT_REFRESH_MS || 30 * 24 * 60 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "faults", type: "faults", event: "refresh", data: {} },
        {
          repeat: { every: FAULT_REFRESH_MS, immediately: true, offset: staggerOffset("faults-refresh", FAULT_REFRESH_MS) },
          jobId: "faults-refresh",
        },
      );
      log(TAG, `registered repeatable faults.refresh`, { everyMs: FAULT_REFRESH_MS });
    } catch (err) {
      log(TAG, `failed to register faults.refresh`, summarizeForLog(err));
    }
  }

  // ---- Repeatable alertGeom.refresh (EMMA area boundaries → Mongo) ----
  // MeteoAlarm ships geocode-only areas, so their alerts have no shape to draw
  // until each EMMA code is resolved via MeteoGate. Boundaries are administrative
  // and permanent, so a run only pays for codes it has never seen — hourly by
  // default just to catch newly-warned areas promptly. Skips itself when no
  // METROGATE_API_KEY is set, so it's inert on installs without a token.
  if (process.env.ALERT_GEOM_REFRESH_ENABLED !== "false") {
    const ALERT_GEOM_MS = Number(process.env.ALERT_GEOM_REFRESH_MS || 60 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "alertGeom", type: "alertGeom", event: "refresh", data: {} },
        {
          repeat: { every: ALERT_GEOM_MS, immediately: true, offset: staggerOffset("alert-geom-refresh", ALERT_GEOM_MS) },
          jobId: "alert-geom-refresh",
        },
      );
      log(TAG, `registered repeatable alertGeom.refresh`, { everyMs: ALERT_GEOM_MS });
    } catch (err) {
      log(TAG, `failed to register alertGeom.refresh`, summarizeForLog(err));
    }
  }

  // ---- Repeatable alertBlobs.refresh (dissolve touching alert areas → Mongo) ----
  // MeteoAlarm issues one alert per county, so the globe would draw hundreds of
  // little squares; unioning the touching ones cuts ~79% of the vertices public
  // has to read and draw.
  //
  // Every 15 minutes, matching ingest — and the cadence is a REAL decision, not a
  // default. A blob is drawn on air, and it's derived purely from the active
  // alert set, so the gap between rebuilds is how long a finished warning keeps
  // glowing and a newly-extended one stays invisible. 15 minutes is as fresh as
  // it can meaningfully be: `alerts.ingest` only polls that often, so the shapes
  // can't lead their own source.
  //
  // This was HOURLY for a while because the rebuild took ~5.5 minutes of solid
  // CPU on a ONE-process worker — 37% of its wall-clock at this cadence, which
  // starved every other job and helped build a 4h queue backlog. What changed is
  // the dedupe (see dissolve.ts `distinctAreas`): the job had been unioning every
  // polygon TWICE (MeteoAlarm ships one info block per language, and a region
  // usually has an original + an update carrying the identical shape). Measured
  // after: 1m42s, ~11% of the worker.
  //
  // So: if this ever creeps back toward ~5 minutes, drop the cadence rather than
  // letting it eat the queue again.
  if (process.env.ALERT_BLOBS_REFRESH_ENABLED !== "false") {
    const ALERT_BLOBS_MS = Number(process.env.ALERT_BLOBS_REFRESH_MS || 15 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "alertBlobs", type: "alertBlobs", event: "refresh", data: {} },
        {
          repeat: { every: ALERT_BLOBS_MS, immediately: true, offset: staggerOffset("alert-blobs-refresh", ALERT_BLOBS_MS) },
          jobId: "alert-blobs-refresh",
        },
      );
      log(TAG, `registered repeatable alertBlobs.refresh`, { everyMs: ALERT_BLOBS_MS });
    } catch (err) {
      log(TAG, `failed to register alertBlobs.refresh`, summarizeForLog(err));
    }
  }

  // ---- Repeatable alertCapId.refresh (WMO capurl → national CAP id → Mongo) ----
  // WMO leaves `identifier` empty, so its alerts can't be matched to the same
  // warning arriving via MeteoAlarm/NWS until each capurl is resolved. A capurl is
  // content-addressed, so a resolved one is permanent — this only ever pays for
  // newly published WMO alerts. Hourly, budgeted, and paced (see capid-sync).
  if (process.env.ALERT_CAPID_REFRESH_ENABLED !== "false") {
    const ALERT_CAPID_MS = Number(process.env.ALERT_CAPID_REFRESH_MS || 60 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "alertCapId", type: "alertCapId", event: "refresh", data: {} },
        {
          repeat: { every: ALERT_CAPID_MS, immediately: true, offset: staggerOffset("alert-capid-refresh", ALERT_CAPID_MS) },
          jobId: "alert-capid-refresh",
        },
      );
      log(TAG, `registered repeatable alertCapId.refresh`, { everyMs: ALERT_CAPID_MS });
    } catch (err) {
      log(TAG, `failed to register alertCapId.refresh`, summarizeForLog(err));
    }
  }

  // ---- Repeatable aurora.refresh (SWPC OVATION oval → baked glow PNG → Mongo) ----
  // The auroral oval moves with geomagnetic activity; SWPC republishes every few
  // minutes, so refresh on a fast cron (5 min by default). A fixed jobId de-dups
  // across restarts; `immediately` seeds the cache at boot so a fresh DB shows the
  // oval right away. Disable with AURORA_REFRESH_ENABLED=false.
  if (process.env.AURORA_REFRESH_ENABLED !== "false") {
    const AURORA_REFRESH_MS = Number(process.env.AURORA_REFRESH_MS || 5 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "aurora", type: "aurora", event: "refresh", data: {} },
        {
          repeat: { every: AURORA_REFRESH_MS, immediately: true, offset: staggerOffset("aurora-refresh", AURORA_REFRESH_MS) },
          jobId: "aurora-refresh",
        },
      );
      log(TAG, `registered repeatable aurora.refresh`, { everyMs: AURORA_REFRESH_MS });
    } catch (err) {
      log(TAG, `failed to register aurora.refresh`, summarizeForLog(err));
    }
  }

  // ---- Repeatable fires.snapshot (NASA FIRMS active fires → Mongo) ----
  // FIRMS republishes NRT detections a few times a day; poll every 30 min by
  // default (cheap; upserts dedup). The job itself no-ops without FIRMS_MAP_KEY,
  // but skip scheduling entirely when the key is absent so a keyless dev env stays
  // quiet. Disable with FIRE_SNAPSHOT_ENABLED=false.
  if (process.env.FIRE_SNAPSHOT_ENABLED !== "false" && (process.env.FIRMS_MAP_KEY || "").trim()) {
    const FIRE_SNAPSHOT_MS = Number(process.env.FIRE_SNAPSHOT_MS || 30 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "fires", type: "fires", event: "snapshot", data: {} },
        {
          repeat: { every: FIRE_SNAPSHOT_MS, immediately: true, offset: staggerOffset("fires-snapshot", FIRE_SNAPSHOT_MS) },
          jobId: "fires-snapshot",
        },
      );
      log(TAG, `registered repeatable fires.snapshot`, { everyMs: FIRE_SNAPSHOT_MS });
    } catch (err) {
      log(TAG, `failed to register fires.snapshot`, summarizeForLog(err));
    }
  }

  // ---- Repeatable volcanoes.snapshot (Smithsonian/USGS Weekly Volcanic Activity Report → Mongo) ----
  // The bulletin itself only republishes once a week (Thursdays) — polling
  // more often than that never finds anything NEW mid-week, it just catches
  // Thursday's fresh drop sooner after it posts. Still cheap (keyless, small
  // feed), so poll every 30 min by default. Keyless, so — unlike fires.snapshot
  // — always scheduled. Disable with VOLCANO_SNAPSHOT_ENABLED=false.
  if (process.env.VOLCANO_SNAPSHOT_ENABLED !== "false") {
    const VOLCANO_SNAPSHOT_MS = Number(process.env.VOLCANO_SNAPSHOT_MS || 30 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "snapshot", data: {} },
        {
          repeat: { every: VOLCANO_SNAPSHOT_MS, immediately: true, offset: staggerOffset("volcanoes-snapshot", VOLCANO_SNAPSHOT_MS) },
          jobId: "volcanoes-snapshot",
        },
      );
      log(TAG, `registered repeatable volcanoes.snapshot`, { everyMs: VOLCANO_SNAPSHOT_MS });
    } catch (err) {
      log(TAG, `failed to register volcanoes.snapshot`, summarizeForLog(err));
    }
  }

  // LLM-parse each volcano's weekly bulletin text into a couple of structured
  // facts (plume height, VEI) — re-checks every time a fresh bulletin lands
  // (see volcano-repo.ts#listNeedingReportParse), not on a fixed staleness gate,
  // so this can poll fairly often; it's a no-op re-scan when nothing's new.
  // Fully skips (no Mongo writes) when OPENROUTER_API_KEY is unset.
  try {
    await addJob(
      "do",
      { domain: "volcanoes", type: "volcanoes", event: "parseReports", data: {} },
      {
        repeat: {
          every: Number(process.env.VOLCANO_PARSE_MS || 3_600_000),
          immediately: true,
          offset: staggerOffset("volcanoes-parse-reports", Number(process.env.VOLCANO_PARSE_MS || 3_600_000)),
        },
        jobId: "volcanoes-parse-reports",
        priority: 10,
      },
    );
    log(TAG, `registered repeatable volcanoes.parseReports`);
  } catch (err) {
    log(TAG, `failed to register volcanoes.parseReports`, summarizeForLog(err));
  }

  // USGS Volcano Notification Service "elevated" feed — near-real-time alert
  // level for the subset of volcanoes USGS actively monitors (US/Alaska/
  // Hawaii/Cascades). Keyless but an undocumented endpoint, so poll modestly
  // and let failures degrade (the GVP snapshot above is unaffected either way).
  // Disable with VOLCANO_USGS_ENABLED=false.
  if (process.env.VOLCANO_USGS_ENABLED !== "false") {
    try {
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "snapshotUsgs", data: {} },
        {
          repeat: {
            every: Number(process.env.VOLCANO_USGS_MS || 15 * 60_000),
            immediately: true,
            offset: staggerOffset("volcanoes-snapshot-usgs", Number(process.env.VOLCANO_USGS_MS || 15 * 60_000)),
          },
          jobId: "volcanoes-snapshot-usgs",
        },
      );
      log(TAG, `registered repeatable volcanoes.snapshotUsgs`);
    } catch (err) {
      log(TAG, `failed to register volcanoes.snapshotUsgs`, summarizeForLog(err));
    }
  }

  // ---- Repeatable volcanoes.snapshotGeonet (official NZ Volcanic Alert Levels) ----
  // Disable with VOLCANO_GEONET_ENABLED=false.
  if (process.env.VOLCANO_GEONET_ENABLED !== "false") {
    try {
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "snapshotGeonet", data: {} },
        {
          repeat: {
            every: Number(process.env.VOLCANO_GEONET_MS || 15 * 60_000),
            immediately: true,
            offset: staggerOffset("volcanoes-snapshot-geonet", Number(process.env.VOLCANO_GEONET_MS || 15 * 60_000)),
          },
          jobId: "volcanoes-snapshot-geonet",
        },
      );
      log(TAG, `registered repeatable volcanoes.snapshotGeonet`);
    } catch (err) {
      log(TAG, `failed to register volcanoes.snapshotGeonet`, summarizeForLog(err));
    }
  }

  // ---- Repeatable volcanoes.ingestGeonetCams (official NZ volcano cameras) ----
  // Disable with VOLCANO_GEONET_CAMS_ENABLED=false.
  if (process.env.VOLCANO_GEONET_CAMS_ENABLED !== "false") {
    try {
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "ingestGeonetCams", data: {} },
        {
          repeat: {
            every: Number(process.env.VOLCANO_GEONET_CAMS_MS || 30 * 60_000),
            immediately: true,
            offset: staggerOffset("volcanoes-geonet-cams", Number(process.env.VOLCANO_GEONET_CAMS_MS || 30 * 60_000)),
          },
          jobId: "volcanoes-geonet-cams",
        },
      );
      log(TAG, `registered repeatable volcanoes.ingestGeonetCams`);
    } catch (err) {
      log(TAG, `failed to register volcanoes.ingestGeonetCams`, summarizeForLog(err));
    }
  }

  // Volcano-specific media enrichment. Registry discovery is cheap and updates
  // metadata; cameraRefresh downloads bytes into the shared blob filesystem.
  if (process.env.VOLCANO_MEDIA_ENABLED !== "false") {
    const REGISTRY_MS = Number(process.env.VOLCANO_MEDIA_REGISTRY_MS || 6 * 60 * 60 * 1000);
    // Hourly, not every 5 minutes. Most observatory cameras only publish a new
    // frame every 10-15 minutes anyway, so the extra polls mostly re-fetched
    // bytes we already had. Lower this if a volcano goes on air and the picture
    // feels stale — it's the ONLY thing setting how fresh the camera slide is.
    const CAMERA_MS = Number(process.env.VOLCANO_MEDIA_CAMERA_MS || 60 * 60 * 1000);
    // Published stills, not live frames: a new eruption photo appears a few times
    // a year, so polling this hard buys nothing. It also walks EVERY volcano
    // (scraping a GVP gallery page each) — cheap at the ~30 volcanoes the weekly
    // bulletin used to hold, ~1,196 page fetches a pass now the full catalog is
    // seeded. Six-hourly keeps us a good citizen of the Smithsonian's server.
    const OFFICIAL_MS = Number(process.env.VOLCANO_MEDIA_OFFICIAL_MS || 6 * 60 * 60 * 1000);
    // Six-hourly, not every 10 minutes. We only ever keep each product's LATEST
    // frame, and the sectors publish every 10-15 min at best — so the frequent
    // polls were re-walking VOLCAT's whole sector/product menu tree to rediscover
    // frames we already had.
    const SATELLITE_MS = Number(process.env.VOLCANO_MEDIA_SATELLITE_MS || 6 * 60 * 60 * 1000);

    /**
     * EXPLICIT offsets, not `staggerOffset`, for the three six-hourly media jobs.
     *
     * `staggerOffset` spreads jobs over at most JOB_STAGGER_MS (4 min), which
     * de-synchronises a boot stampede but can't separate jobs on a 6h cycle: it
     * put satellite at +0.09min and official at +0.87min — 47 seconds apart.
     * That's not merely a load spike. `officialMedia` and `satelliteMedia` share
     * the `volcano-media` lock, so the second to arrive finds it held and SKIPS
     * — meaning official media would never run at all, every cycle, forever.
     *
     * Two hours apart is far longer than any of them takes, so each has the lock
     * to itself and the volcano work is spread evenly through the day rather
     * than landing in one lump.
     */
    const HOUR_MS = 60 * 60 * 1000;
    const SATELLITE_OFFSET_MS = 0;
    const OFFICIAL_OFFSET_MS = 2 * HOUR_MS;
    const REGISTRY_OFFSET_MS = 4 * HOUR_MS;

    try {
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "mediaRegistry", data: {} },
        { repeat: { every: REGISTRY_MS, immediately: true, offset: REGISTRY_OFFSET_MS }, jobId: "volcano-media-registry" },
      );
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "cameraRefresh", data: {} },
        // Hourly and on its OWN lock, so it can't be starved by the six-hourly
        // sweeps — the hash stagger is all it needs.
        { repeat: { every: CAMERA_MS, offset: staggerOffset("volcano-camera-refresh", CAMERA_MS) }, jobId: "volcano-camera-refresh" },
      );
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "officialMedia", data: {} },
        { repeat: { every: OFFICIAL_MS, offset: OFFICIAL_OFFSET_MS }, jobId: "volcano-official-media" },
      );
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "satelliteMedia", data: {} },
        { repeat: { every: SATELLITE_MS, offset: SATELLITE_OFFSET_MS }, jobId: "volcano-satellite-media" },
      );
      // Backstop for the latest-only camera policy: `cameraRefresh` overwrites in
      // place, so this normally finds nothing. It exists so any future writer that
      // appends camera frames can't quietly regrow the archive.
      const MEDIA_PRUNE_MS = 24 * 60 * 60 * 1000;
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoCatalog", event: "pruneMedia", data: {} },
        { repeat: { every: MEDIA_PRUNE_MS, offset: staggerOffset("volcano-media-prune", MEDIA_PRUNE_MS) }, jobId: "volcano-media-prune" },
      );
      log(TAG, "registered volcano media registry + acquisition", {
        registryMs: REGISTRY_MS, cameraMs: CAMERA_MS, officialMs: OFFICIAL_MS, satelliteMs: SATELLITE_MS,
        offsetsHours: { satellite: SATELLITE_OFFSET_MS / HOUR_MS, official: OFFICIAL_OFFSET_MS / HOUR_MS, registry: REGISTRY_OFFSET_MS / HOUR_MS },
      });
    } catch (err) {
      log(TAG, "failed to register volcano media jobs", summarizeForLog(err));
    }
  }

  // ---- Repeatable volcano camera frame capture / timelapse / prune (P2b) ----
  // Opt-IN (fetches + STORES third-party images): VOLCANO_CAM_SNAPSHOT_ENABLED=true
  // (also needs EVENTS_UNIFIED_ENABLED — frames key on a volcano's WatchedEvent).
  // Capture hourly, rebuild the timelapse + prune once a day.
  if (process.env.VOLCANO_CAM_SNAPSHOT_ENABLED === "true") {
    const CAM_SNAP_MS = Number(process.env.VOLCANO_CAM_SNAPSHOT_MS || 60 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "snapshotCams", data: {} },
        {
          repeat: { every: CAM_SNAP_MS, offset: staggerOffset("volcanoes-snapshot-cams", CAM_SNAP_MS) },
          jobId: "volcanoes-snapshot-cams",
        },
      );
      log(TAG, `registered repeatable volcanoes.snapshotCams`, { everyMs: CAM_SNAP_MS });
    } catch (err) {
      log(TAG, `failed to register volcanoes.snapshotCams`, summarizeForLog(err));
    }
    const CAM_DAILY_MS = 24 * 60 * 60 * 1000;
    try {
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "timelapseCams", data: {} },
        {
          repeat: { every: CAM_DAILY_MS, offset: staggerOffset("volcanoes-timelapse-cams", CAM_DAILY_MS) },
          jobId: "volcanoes-timelapse-cams",
        },
      );
      await addJob(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "pruneCamSnapshots", data: {} },
        {
          repeat: { every: CAM_DAILY_MS, offset: staggerOffset("volcanoes-prune-cams", CAM_DAILY_MS) },
          jobId: "volcanoes-prune-cams",
        },
      );
      log(TAG, `registered repeatable volcanoes.timelapseCams + pruneCamSnapshots`);
    } catch (err) {
      log(TAG, `failed to register volcano timelapse/prune`, summarizeForLog(err));
    }
  }

  // ---- Repeatable geomag.refresh (IGRF total-intensity field → baked scalar PNG) ----
  // The geomagnetic field drifts only slowly (secular variation), so re-bake weekly
  // by default. A fixed jobId de-dups across restarts; `immediately` seeds the cache
  // at boot so a fresh DB shows the field right away. Disable with GEOMAG_REFRESH_ENABLED=false.
  if (process.env.GEOMAG_REFRESH_ENABLED !== "false") {
    const GEOMAG_REFRESH_MS = Number(process.env.GEOMAG_REFRESH_MS || 7 * 24 * 60 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "geomag", type: "geomag", event: "refresh", data: {} },
        {
          repeat: { every: GEOMAG_REFRESH_MS, immediately: true, offset: staggerOffset("geomag-refresh", GEOMAG_REFRESH_MS) },
          jobId: "geomag-refresh",
        },
      );
      log(TAG, `registered repeatable geomag.refresh`, { everyMs: GEOMAG_REFRESH_MS });
    } catch (err) {
      log(TAG, `failed to register geomag.refresh`, summarizeForLog(err));
    }
  }

  // ---- Repeatable satimg.refresh (satellite imagery → cloud-keyed PNG → Mongo) ----
  // DEFAULT source "gibs": bakes every "clouds" FEED (global daily true-colour mosaic +
  // live GOES-East/West GeoColor + Himawari IR) into its own cached frame, cloud-keyed
  // so clear sky is transparent and only clouds drape on the globe. Pure Node (no venv,
  // Docker-trivial) → ON by default; opt out with SATIMG_REFRESH_ENABLED=false. The
  // live discs update ~10-min, so refresh every 30 min (the global mosaic is daily but
  // re-fetching is cheap). `immediately` seeds at boot. SATIMG_SOURCE=satpy → raw
  // Himawari disk bake instead (needs the Python venv — see WORKER.md).
  if (process.env.SATIMG_REFRESH_ENABLED !== "false") {
    const SATIMG_REFRESH_MS = Number(process.env.SATIMG_REFRESH_MS || 30 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "satimg", type: "satimg", event: "refresh", data: {} },
        {
          repeat: { every: SATIMG_REFRESH_MS, immediately: true, offset: staggerOffset("satimg-refresh", SATIMG_REFRESH_MS) },
          jobId: "satimg-refresh",
        },
      );
      log(TAG, `registered repeatable satimg.refresh`, {
        everyMs: SATIMG_REFRESH_MS,
        source: process.env.SATIMG_SOURCE ?? "gibs",
      });
    } catch (err) {
      log(TAG, `failed to register satimg.refresh`, summarizeForLog(err));
    }
  }

  // ---- Repeatable tides.* (sea-level gauges for the on-air tsunami monitor) ----
  // `refreshStations` rebuilds the global IOC gauge catalog (near-static, daily);
  // `snapshotTides` caches recent water-level series for the gauges nearest what's
  // on air (frequent, focus-driven — a handful of stations per tick). The public
  // gauge reads Mongo only. `immediately` seeds the catalog at boot so the first
  // snapshot has stations to resolve against. Disable with TIDES_ENABLED=false.
  if (process.env.TIDES_ENABLED !== "false") {
    const TIDE_STATIONS_MS = Number(process.env.TIDE_STATIONS_MS || 24 * 60 * 60 * 1000);
    const TIDE_SNAPSHOT_MS = Number(process.env.TIDE_SNAPSHOT_MS || 10 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "tides", type: "tides", event: "refreshStations", data: {} },
        {
          repeat: { every: TIDE_STATIONS_MS, immediately: true, offset: staggerOffset("tides-refresh-stations", TIDE_STATIONS_MS) },
          jobId: "tides-refresh-stations",
        },
      );
      await addJob(
        "do",
        { domain: "tides", type: "tides", event: "snapshotTides", data: {} },
        {
          repeat: { every: TIDE_SNAPSHOT_MS, offset: staggerOffset("tides-snapshot", TIDE_SNAPSHOT_MS) },
          jobId: "tides-snapshot",
        },
      );
      log(TAG, `registered repeatable tides.*`, { stationsMs: TIDE_STATIONS_MS, snapshotMs: TIDE_SNAPSHOT_MS });
    } catch (err) {
      log(TAG, `failed to register tides.*`, summarizeForLog(err));
    }
  }

  // ---- Repeatable seismo.refreshStations (GSN broadband-station catalog) ----
  // Near-static reference data (daily); the snapshot job reads it to pick
  // stations near what's on air. `immediately` seeds the catalog at boot so the
  // first snapshot has stations to resolve against right away.
  if (process.env.SEISMO_ENABLED !== "false") {
    const SEISMO_STATIONS_MS = Number(process.env.SEISMO_STATIONS_MS || 24 * 60 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "seismo", type: "seismo", event: "refreshStations", data: {} },
        {
          repeat: { every: SEISMO_STATIONS_MS, immediately: true, offset: staggerOffset("seismo-refresh-stations", SEISMO_STATIONS_MS) },
          jobId: "seismo-refresh-stations",
        },
      );
      log(TAG, `registered repeatable seismo.refreshStations`, { stationsMs: SEISMO_STATIONS_MS });
    } catch (err) {
      log(TAG, `failed to register seismo.refreshStations`, summarizeForLog(err));
    }

    // ---- Repeatable seismo.snapshot (short waveform burst, not an always-on stream) ----
    // Replaces the old persistent SeedLink connection: every few minutes we open
    // SeedLink, grab a short window of waveform for the in-focus stations, then
    // close. Between snapshots the worker does no seismic work. Tune the cadence
    // with SEISMO_SNAPSHOT_MS and the per-burst capture length with
    // SEISMO_SNAPSHOT_WINDOW_SEC.
    const SEISMO_SNAPSHOT_MS = Number(process.env.SEISMO_SNAPSHOT_MS || 5 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "seismo", type: "seismo", event: "snapshot", data: {} },
        {
          repeat: { every: SEISMO_SNAPSHOT_MS, immediately: true, offset: staggerOffset("seismo-snapshot", SEISMO_SNAPSHOT_MS) },
          jobId: "seismo-snapshot",
        },
      );
      log(TAG, `registered repeatable seismo.snapshot`, { snapshotMs: SEISMO_SNAPSHOT_MS });
    } catch (err) {
      log(TAG, `failed to register seismo.snapshot`, summarizeForLog(err));
    }
  }

  // ---- Repeatable climate.snapshotClimate (past-year ERA5 for what's on air) ----
  // Focus-driven like tides: caches the past year of Open-Meteo/ERA5 daily
  // climate for the on-air camera point + significant quakes, one Mongo doc per
  // 0.1° key, refreshed daily. The public /climate route (director-mode PAST
  // YEAR charts) reads Mongo only. Disable with CLIMATE_ENABLED=false.
  if (process.env.CLIMATE_ENABLED !== "false") {
    const CLIMATE_SNAPSHOT_MS = Number(process.env.CLIMATE_SNAPSHOT_MS || 10 * 60 * 1000);
    try {
      await addJob(
        "do",
        { domain: "climate", type: "climate", event: "snapshotClimate", data: {} },
        {
          repeat: { every: CLIMATE_SNAPSHOT_MS, immediately: true, offset: staggerOffset("climate-snapshot", CLIMATE_SNAPSHOT_MS) },
          jobId: "climate-snapshot",
        },
      );
      log(TAG, `registered repeatable climate.snapshotClimate`, { snapshotMs: CLIMATE_SNAPSHOT_MS });
    } catch (err) {
      log(TAG, `failed to register climate.snapshotClimate`, summarizeForLog(err));
    }
  }

  // ---- Repeatable climate.backfillClimate (weekly all-city past-year sweep) ----
  // The focus snapshot above only caches what the live camera framed, so the
  // director PAST YEAR / monthly-climate panel 404s anywhere the broadcast hasn't
  // visited. This sweeps EVERY city >= floor (deduped 0.1° keys) into the cache in
  // restartable LOW-priority batches. Weekly cadence keeps those docs refreshed
  // ahead of the 14-day collection TTL (points not re-fetched <6 days are skipped
  // internally, so most of a run is a cheap staleness scan). Disable with
  // CLIMATE_BACKFILL_ENABLED=false; force now from the /admin/jobs button.
  if (process.env.CLIMATE_BACKFILL_ENABLED !== "false") {
    try {
      await addJob(
        "do",
        { domain: "climate", type: "climate", event: "backfillClimate", data: {} },
        {
          repeat: { pattern: process.env.CLIMATE_BACKFILL_CRON || "30 3 * * 0" }, // Sundays 03:30
          jobId: "climate-backfill",
          priority: 10, // LOW — background bulk, never contends with live jobs
        },
      );
      log(TAG, `registered repeatable climate.backfillClimate`);
    } catch (err) {
      log(TAG, `failed to register climate.backfillClimate`, summarizeForLog(err));
    }
  }

  // ---- Repeatable summaries.generate* (global weather-event round-ups → Mongo) ----
  // One repeatable per cadence (hourly / 12-hourly / daily). Each aggregates the
  // active events into a stored round-up (+ optional LLM narrative) that the admin
  // screen reads. Fixed jobIds de-dup across restarts; crons are env-overridable.
  if (process.env.SUMMARIES_ENABLED !== "false") {
    // Staggered default minutes (hashed 2-14), not :00 — an hourly round-up a
    // few minutes into the hour is editorially identical, and :00 was the
    // minute the whole fleet used to detonate on together.
    const summaryCrons = [
      { event: "generateHourly", cron: process.env.SUMMARY_HOURLY_CRON || `${staggerMinute("summaries-hourly", 2, 14)} * * * *`, id: "summaries-hourly" },
      { event: "generate12h", cron: process.env.SUMMARY_12H_CRON || `${staggerMinute("summaries-12h", 2, 14)} 0,12 * * *`, id: "summaries-12h" },
      { event: "generateDaily", cron: process.env.SUMMARY_DAILY_CRON || `${staggerMinute("summaries-daily", 2, 14)} 0 * * *`, id: "summaries-daily" },
    ];
    for (const { event, cron, id } of summaryCrons) {
      try {
        await addJob(
          "do",
          { domain: "summaries", type: "summaries", event, data: {} },
          { repeat: { pattern: cron }, jobId: id },
        );
        log(TAG, `registered repeatable summaries.${event}`, { cron });
      } catch (err) {
        log(TAG, `failed to register summaries.${event}`, summarizeForLog(err));
      }
    }
  }

  // ---- Repeatable placeRoundups.generate* (per-country/region local-time round-ups) ----
  // Two crons — countries (opt-in via roundupEnabled) and regions (all) — offset
  // past summaries so the LLM calls don't bunch. They now fire HOURLY, but each
  // run only generates the places whose LOCAL time is currently in a target slot
  // (~6am + ~6pm there, see placeRoundups/localTime.ts), so every place's round-up
  // lands in its own morning/evening instead of a fixed UTC instant. Each loops
  // its due places, feeding the previous round-up back in for continuity. No-ops
  // for prose without an OPENROUTER_API_KEY (inputs still stored). Fixed jobIds
  // de-dup across restarts; trigger on demand from the /admin/jobs buttons too
  // (set PLACE_ROUNDUP_IGNORE_LOCAL_TIME=true to force the whole set). Disable
  // with PLACE_ROUNDUPS_ENABLED=false.
  if (process.env.PLACE_ROUNDUPS_ENABLED !== "false") {
    const placeRoundupCrons = [
      { event: "generateCountries", cron: process.env.PLACE_ROUNDUP_COUNTRIES_CRON || "20 * * * *", id: "place-roundups-countries" },
      { event: "generateRegions", cron: process.env.PLACE_ROUNDUP_REGIONS_CRON || "40 * * * *", id: "place-roundups-regions" },
    ];
    for (const { event, cron, id } of placeRoundupCrons) {
      try {
        await addJob(
          "do",
          { domain: "placeRoundups", type: "placeRoundups", event, data: {} },
          // Normal priority (5): heavier than a live tick shouldn't wait on, but
          // not the low-priority bucket where enrichment sweeps sit.
          { repeat: { pattern: cron }, jobId: id, priority: 5 },
        );
        log(TAG, `registered repeatable placeRoundups.${event}`, { cron });
      } catch (err) {
        log(TAG, `failed to register placeRoundups.${event}`, summarizeForLog(err));
      }
    }
  }

  // ---- Repeatable areaWeather.run (hourly per-country/region weather snapshot) ----
  // Offset 10 past the hour so it doesn't contend with summaries-hourly's :00 run.
  // Country/region CATALOG seeding (countries.seed/regions.seed) is intentionally
  // NOT scheduled here — Natural Earth boundaries and the curated region list
  // don't change; reseed manually (yarn seed:countries/seed:regions or the
  // matching /admin/jobs buttons) if the source data is ever refreshed.
  if (process.env.AREA_WEATHER_ENABLED !== "false") {
    try {
      await addJob(
        "do",
        { domain: "areaWeather", type: "areaWeather", event: "run", data: {} },
        { repeat: { pattern: process.env.AREA_WEATHER_CRON || "10 * * * *" }, jobId: "area-weather-run" },
      );
      log(TAG, `registered repeatable areaWeather.run`);
    } catch (err) {
      log(TAG, `failed to register areaWeather.run`, summarizeForLog(err));
    }
  }

  // ---- Repeatable cityWeather.refresh (hourly ≥100k-city point cache) ----
  // Offset to :20 so temp/wind/rain frames + the forecast store are settled from
  // the top-of-hour ingest before this samples them.
  if (process.env.CITY_WEATHER_ENABLED !== "false") {
    try {
      await addJob(
        "do",
        { domain: "cityWeather", type: "cityWeather", event: "refresh", data: {} },
        { repeat: { pattern: process.env.CITY_WEATHER_CRON || "20 * * * *" }, jobId: "city-weather-refresh" },
      );
      log(TAG, `registered repeatable cityWeather.refresh`);
    } catch (err) {
      log(TAG, `failed to register cityWeather.refresh`, summarizeForLog(err));
    }
  }

  // ---- Repeatable weatherPanels.refresh (hourly country/region panel cache) ----
  // Precomputes point + area history for every catalog country/region into Redis
  // so `public`'s focus composer reads numbers instead of sharp-decoding frames
  // per request. Offset to :35 — after cityWeather (:20), off the top-of-hour
  // ingest, so the frame archive is settled before this samples it.
  if (process.env.WEATHER_PANELS_ENABLED !== "false") {
    try {
      await addJob(
        "do",
        { domain: "weatherPanels", type: "weatherPanels", event: "refresh", data: {} },
        { repeat: { pattern: process.env.WEATHER_PANELS_CRON || "35 * * * *" }, jobId: "weather-panels-refresh" },
      );
      log(TAG, `registered repeatable weatherPanels.refresh`);
    } catch (err) {
      log(TAG, `failed to register weatherPanels.refresh`, summarizeForLog(err));
    }
  }

  // Catalog enrichment (countries/regions/volcanoes/cities) is deliberately NOT
  // scheduled and does not run at boot. These catalogs are near-permanent, so a
  // sweep is an operator decision, not a clock's — trigger it from /admin or the
  // enrich:* CLI scripts.

  // ---- Express HTTP server (health/status probes) ----
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => res.send(`worker v${packageJson.version}`));

  app.get("/status", async (_req, res) => {
    if (_req.headers["x-forwarded-for"] || _req.headers["x-forwarded-host"]) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      // Counts per tier + a summed total, so /status shows the fg/mid/bg split.
      // Each tier carries its effective concurrency — the cap the health UI draws
      // the "N of M lanes busy" gauge against (background's cap is the heap bound).
      const states = ["waiting", "active", "delayed", "completed", "failed", "paused"] as const;
      const perTier = await Promise.all(
        QUEUE_TIERS.map(async (tier) => {
          const c = await getQueue(tier).getJobCounts(...states);
          return { tier, name: QUEUE_NAMES[tier], concurrency: concurrencyFor(tier), counts: c };
        }),
      );
      const counts = states.reduce<Record<string, number>>((acc, s) => {
        acc[s] = perTier.reduce((sum, t) => sum + (t.counts[s] ?? 0), 0);
        return acc;
      }, {});
      // Per-event usage table (runs/errors/timing/peak mem), heaviest by peak heap
      // delta first — "which event type grows the heap most" is the OOM question.
      const events = [...eventStats.entries()]
        .map(([label, s]) => ({ label, ...s, avgMs: Math.round(s.totalMs / Math.max(1, s.runs)) }))
        .sort((a, b) => b.peakHeapDeltaMB - a.peakHeapDeltaMB);
      const m = process.memoryUsage();
      res.json({
        status: "ok",
        queues: QUEUE_NAMES,
        counts,
        byTier: perTier,
        // Memory snapshot: rss (the OS-visible footprint, what OOM-kills), the JS
        // heap in use vs the V8 old-space ceiling (the 4GB limit we crashed into),
        // and the rss high-water since boot.
        rssMB: mb(m.rss),
        rssPeakMB: mb(rssHighWater),
        heapUsedMB: mb(m.heapUsed),
        heapTotalMB: mb(m.heapTotal),
        heapLimitMB: mb(v8.getHeapStatistics().heap_size_limit),
        externalMB: mb(m.external),
        // Bake-thread lifecycle: each worker thread is a V8 isolate whose memory
        // shows only in rss, so spawned/recycled/crashed says how much of the
        // rss-vs-heap gap is pool churn (recycled climbing = memory being handed
        // back; crashed>0 = check logs; worker=0 with inline>0 = pool broken).
        bakePool: bakePoolStats(),
        uptimeSec: Math.round(process.uptime()),
        // Labels of jobs running RIGHT NOW — the ledger only has finished runs, so
        // this is how the UI flags which event types are in flight.
        active: activeJobLabels(),
        events,
        time: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ status: "error", error: err?.message || String(err) });
    }
  });

  app.get("/version", (_req, res) => res.json({ name: packageJson.name, version: packageJson.version, port: PORT }));

  // ---- Internal frame-sampling API (public → worker) --------------------------
  // The worker is the sole frame DECODER: public POSTs sampling requests here
  // instead of sharp-decoding weather PNGs in the user-facing Next process. These
  // read frame bytes from the shared blob store, decode + sample, and return small
  // numeric series. Internal-only — reject anything that arrived via a proxy (same
  // guard as /status), since only the compose `internal` network should reach it.
  const internalOnly = (req: express.Request, res: express.Response): boolean => {
    if (req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"]) {
      res.status(403).json({ error: "Forbidden" });
      return false;
    }
    return true;
  };
  const asDate = (v: unknown): Date | undefined => {
    if (v == null) return undefined;
    const d = new Date(v as string | number);
    return isNaN(d.getTime()) ? undefined : d;
  };

  app.post("/internal/weather/history/point", async (req, res) => {
    if (!internalOnly(req, res)) return;
    try {
      const b = req.body ?? {};
      if (!b.variable || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
        return res.status(400).json({ error: "variable, lat, lng required" });
      }
      const db = await getAppDb();
      const series = await samplePointHistory(db, {
        variable: String(b.variable),
        lat: Number(b.lat),
        lng: Number(b.lng),
        from: asDate(b.from),
        to: asDate(b.to),
        model: b.model ? String(b.model) : undefined,
      });
      res.json(series);
    } catch (err) {
      log(TAG, "sample point history failed", summarizeForLog(err));
      res.status(500).json({ error: "sample failed" });
    }
  });

  app.post("/internal/weather/history/area", async (req, res) => {
    if (!internalOnly(req, res)) return;
    try {
      const b = req.body ?? {};
      const bbox = b.bbox;
      if (!b.variable || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
        return res.status(400).json({ error: "variable, bbox[4] required" });
      }
      const db = await getAppDb();
      const series = await sampleAreaHistory(db, {
        variable: String(b.variable),
        bbox: bbox as [number, number, number, number],
        from: asDate(b.from),
        to: asDate(b.to),
        model: b.model ? String(b.model) : undefined,
      });
      res.json(series);
    } catch (err) {
      log(TAG, "sample area history failed", summarizeForLog(err));
      res.status(500).json({ error: "sample failed" });
    }
  });

  app.post("/internal/weather/forecast/point", async (req, res) => {
    if (!internalOnly(req, res)) return;
    try {
      const b = req.body ?? {};
      if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng) || !Array.isArray(b.variables)) {
        return res.status(400).json({ error: "lat, lng, variables[] required" });
      }
      const db = await getAppDb();
      const series = await sampleForecastPoint(db, {
        lat: Number(b.lat),
        lng: Number(b.lng),
        variables: b.variables.map(String),
        model: b.model ? String(b.model) : undefined,
        maxHours: Number.isFinite(b.maxHours) ? Number(b.maxHours) : undefined,
      });
      res.json(series);
    } catch (err) {
      log(TAG, "sample forecast point failed", summarizeForLog(err));
      res.status(500).json({ error: "sample failed" });
    }
  });

  app.post("/internal/weather/forecast/area", async (req, res) => {
    if (!internalOnly(req, res)) return;
    try {
      const b = req.body ?? {};
      const bbox = b.bbox;
      if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite) || !Array.isArray(b.variables)) {
        return res.status(400).json({ error: "bbox[4], variables[] required" });
      }
      const db = await getAppDb();
      const series = await sampleForecastArea(db, {
        bbox: bbox as [number, number, number, number],
        variables: b.variables.map(String),
        model: b.model ? String(b.model) : undefined,
        maxHours: Number.isFinite(b.maxHours) ? Number(b.maxHours) : undefined,
      });
      res.json(series);
    } catch (err) {
      log(TAG, "sample forecast area failed", summarizeForLog(err));
      res.status(500).json({ error: "sample failed" });
    }
  });

  app.get("/healthz", async (_req, res) => {
    try {
      // Any tier's queue shares the Redis connection — this is just a liveness ping.
      await getQueue().getWaitingCount();
      res.status(200).send("ok");
    } catch {
      res.status(503).send("unhealthy");
    }
  });

  const server = http.createServer(app);
  server.listen(PORT, () => console.log(`\n🟢 WORKER HTTP SERVER LISTENING ON PORT ${PORT}\n`));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      // Second Ctrl-C / signal: stop waiting on the graceful drain and bail now.
      log(TAG, `shutdown forced`, signal);
      process.exit(1);
    }
    shuttingDown = true;
    log(TAG, `shutdown requested`, signal);

    // Stop the director loop FIRST: it's a 1s setInterval that keeps building
    // candidates and emitting director:state cuts. If we don't kill it here it
    // carries on cutting shots the whole time bullWorker.close() drains jobs.
    stopDirector();

    // Backstop: if the graceful drain wedges (e.g. a stuck job holding its
    // lock), force-exit so quit always actually quits.
    const forceTimer = setTimeout(() => {
      log(TAG, `shutdown timed out — forcing exit`);
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    try {
      // Stop accepting HTTP first, then drain the queue, then release the
      // shared handles (socket, Redis, Mongo pool) so nothing is left dangling
      // for process.exit to reap.
      await new Promise<void>((resolve) => server.close(() => resolve()));
      stopQueueEventBridge();
      stopJobConsoleTap();
      stopCancelSubscriber();
      closeSocket();
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(queues.map((q) => q.close()));
      await closeDb();
    } catch (err) {
      log(TAG, `shutdown failed`, summarizeForLog(err));
    } finally {
      clearTimeout(forceTimer);
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})().catch((err) => {
  console.error("[worker] fatal startup error:", err);
  process.exit(1);
});
