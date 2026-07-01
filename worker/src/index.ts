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

import { QUEUE_NAME } from "@photonsurge/shared/utill/bull-utils";
import { getQueue, getRedisOptions } from "@photonsurge/shared/bull/bull";
import { getDb } from "@photonsurge/shared/utill/mongoose";
import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";
import { WorkerBackLogger } from "@photonsurge/shared/utill/BackLogger";

import { initSocket, closeSocket } from "./socket";
import { startDirector, stopDirector } from "./director/loop";
import { getEnabledSources } from "./alerts/registry";
import { getEnabledCamSources } from "./cams/registry";
import { summarizeForLog } from "./utils";
import packageJson from "../package.json";

const TAG = "worker";
const PORT = Number(process.env.PORT || 8080);

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
  const myQueue = getQueue();
  await initSocket();

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

  const bullWorker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const type = typeof job.data?.type === "string" ? job.data.type : "unknown";
      const event = typeof job.data?.event === "string" ? job.data.event : "unknown";
      log(TAG, `job:start [${job.id}] ${type}.${event}`);
      const handler = handlers[type];
      if (!handler) throw new Error(`No handler for type: ${type}`);
      const fn = handler[event];
      if (!fn) throw new Error(`No handler for event: ${type}.${event}`);
      try {
        const result = await fn(job);
        log(TAG, `job:done  [${job.id}] ${type}.${event}`);
        WorkerBackLogger(TAG, "event", `job:${type}`, `${type}.${event} done`, result, type, String(job.id ?? ""));
        return result;
      } catch (ex) {
        log(TAG, `job:error [${job.id}] ${type}.${event}`, summarizeForLog(ex));
        WorkerBackLogger(TAG, "error", `job:${type}`, `${type}.${event} failed`, summarizeForLog(ex), type, String(job.id ?? ""));
        throw ex;
      }
    },
    // BullMQ requires maxRetriesPerRequest: null on the worker's blocking connection.
    { connection: { ...getRedisOptions(), maxRetriesPerRequest: null }, concurrency: 5, stalledInterval: 30_000, maxStalledCount: 2 },
  );

  // Clear stale repeatable schedules before re-registering. BullMQ keys a
  // repeatable by its options, so changing an interval (e.g. SHIP_SNAPSHOT_MS)
  // with the same jobId leaves the OLD schedule firing alongside the new one.
  // Wiping them here means the registrations below are always authoritative.
  try {
    const repeatables = await myQueue.getRepeatableJobs();
    for (const r of repeatables) await myQueue.removeRepeatableByKey(r.key);
    if (repeatables.length) log(TAG, `cleared ${repeatables.length} stale repeatable(s)`);
  } catch (err) {
    log(TAG, `failed to clear stale repeatables`, summarizeForLog(err));
  }

  // ---- Repeatable weather.check job (BullMQ, not node-cron) ----
  // Enqueues `{ type:"weather", event:"check" }` on RUN_CHECK_CRON. A fixed
  // jobId de-duplicates the repeat scheduler across restarts.
  const RUN_CHECK_CRON = process.env.RUN_CHECK_CRON || "*/30 * * * *";
  try {
    await myQueue.add(
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
    const sourceJobs: Array<{ event: string; sourceId: string; every: number }> = [
      { event: "refreshIfs", sourceId: "ifs", every: Number(process.env.IFS_INGEST_MS || 60 * 60 * 1000) },
      { event: "refreshWaves", sourceId: "gfswave-mosaic", every: Number(process.env.WAVE_INGEST_MS || 60 * 60 * 1000) },
      { event: "refreshRtofs", sourceId: "rtofs", every: Number(process.env.RTOFS_INGEST_MS || 3 * 60 * 60 * 1000) },
      // Phase 2 regional nests (zoom-gated high-res overlays). Idempotent like the
      // rest — polling just re-checks availability. MRMS radar polls fast (live
      // layer); HRRR/ICON-D2 are hourly/3-hourly forecast nests.
      { event: "refreshIconD2", sourceId: "icon-d2", every: Number(process.env.ICON_D2_INGEST_MS || 30 * 60 * 1000) },
      { event: "refreshIconEu", sourceId: "icon-eu", every: Number(process.env.ICON_EU_INGEST_MS || 30 * 60 * 1000) },
      { event: "refreshHrrr", sourceId: "hrrr", every: Number(process.env.HRRR_INGEST_MS || 30 * 60 * 1000) },
      { event: "refreshMrms", sourceId: "mrms", every: Number(process.env.MRMS_INGEST_MS || 2 * 60 * 1000) },
      // 2a/2e cover MANY sources (4 wave basins, 11 RTOFS windows); one job each
      // loops its whole family, so a single sentinel id gates the group's schedule.
      { event: "refreshWaveNests", sourceId: "gfswave-atlocn", every: Number(process.env.WAVE_NEST_INGEST_MS || 60 * 60 * 1000) },
      { event: "refreshRtofsRegional", sourceId: "rtofs-westatl", every: Number(process.env.RTOFS_REGIONAL_INGEST_MS || 3 * 60 * 60 * 1000) },
      // "Everywhere" nests: worldwide 13 km + Canada 2.5 km + UK 2 km.
      { event: "refreshIconGlobal", sourceId: "icon-global", every: Number(process.env.ICON_GLOBAL_INGEST_MS || 60 * 60 * 1000) },
      { event: "refreshHrdps", sourceId: "hrdps", every: Number(process.env.HRDPS_INGEST_MS || 30 * 60 * 1000) },
      { event: "refreshUkv", sourceId: "ukv", every: Number(process.env.UKV_INGEST_MS || 30 * 60 * 1000) },
    ];
    // Only schedule ENABLED sources (IFS is off by default until CCSDS-validated).
    for (const { event, sourceId, every } of sourceJobs.filter((j) => getSource(j.sourceId)?.enabled)) {
      try {
        await myQueue.add(
          "do",
          { domain: "weather", type: "weather", event, data: {} },
          { repeat: { every }, jobId: `weather-${event}` },
        );
        // BullMQ `repeat: { every }` only fires the FIRST run one interval later,
        // so a fresh worker would sit empty for up to `every` ms. Kick each ingest
        // ONCE at boot so everything auto-populates immediately (then the repeat
        // takes over). Idempotent (alreadyPublished skips) + nomadsGate-throttled,
        // so it just re-checks availability. Disable with WEATHER_INGEST_ON_BOOT=false.
        if (process.env.WEATHER_INGEST_ON_BOOT !== "false") {
          await myQueue.add(
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
      await myQueue.add(
        "do",
        { domain: "alerts", type: "alerts", event: "ingest", data: { source: source.id } },
        { repeat: { every: source.pollIntervalSec * 1000 }, jobId: `alerts-${source.id}` },
      );
      log(TAG, `registered repeatable alerts.ingest`, { source: source.id, every: source.pollIntervalSec });
    } catch (err) {
      log(TAG, `failed to register alerts.ingest`, { source: source.id, err: summarizeForLog(err) });
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
        await myQueue.add(
          "do",
          { domain: "cams", type: "cams", event: "ingest", data: { source: source.id } },
          { repeat: { every: source.pollIntervalSec * 1000, immediately: true }, jobId: `cams-${source.id}` },
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
    await myQueue.add(
      "do",
      { domain: "tracks", type: "tracks", event: "ingestTles", data: {} },
      { repeat: { every: TLE_INGEST_MS, immediately: true }, jobId: "tracks-tles" },
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
      await myQueue.add(
        "do",
        { domain: "tracks", type: "tracks", event: "snapshotAircraft", data: {} },
        { repeat: { every: AIRCRAFT_SNAPSHOT_MS, immediately: true }, jobId: "tracks-snapshot-aircraft" },
      );
      await myQueue.add(
        "do",
        { domain: "tracks", type: "tracks", event: "snapshotShips", data: {} },
        { repeat: { every: SHIP_SNAPSHOT_MS, immediately: true }, jobId: "tracks-snapshot-ships" },
      );
      // Progressively fill the keyless hexdb aircraft-metadata cache.
      await myQueue.add(
        "do",
        { domain: "tracks", type: "tracks", event: "enrichAircraft", data: {} },
        {
          repeat: { every: Number(process.env.AIRCRAFT_ENRICH_MS || 60_000), immediately: true },
          jobId: "tracks-enrich-aircraft",
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
      await myQueue.add(
        "do",
        { domain: "tracks", type: "tracks", event: "snapshotSeismic", data: {} },
        { repeat: { every: SEISMIC_SNAPSHOT_MS }, jobId: "tracks-snapshot-seismic" },
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
      await myQueue.add(
        "do",
        { domain: "cables", type: "cables", event: "refresh", data: {} },
        { repeat: { every: CABLE_REFRESH_MS, immediately: true }, jobId: "cables-refresh" },
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
      await myQueue.add(
        "do",
        { domain: "faults", type: "faults", event: "refresh", data: {} },
        { repeat: { every: FAULT_REFRESH_MS, immediately: true }, jobId: "faults-refresh" },
      );
      log(TAG, `registered repeatable faults.refresh`, { everyMs: FAULT_REFRESH_MS });
    } catch (err) {
      log(TAG, `failed to register faults.refresh`, summarizeForLog(err));
    }
  }

  // ---- Repeatable summaries.generate* (global weather-event round-ups → Mongo) ----
  // One repeatable per cadence (hourly / 12-hourly / daily). Each aggregates the
  // active events into a stored round-up (+ optional LLM narrative) that the admin
  // screen reads. Fixed jobIds de-dup across restarts; crons are env-overridable.
  if (process.env.SUMMARIES_ENABLED !== "false") {
    const summaryCrons = [
      { event: "generateHourly", cron: process.env.SUMMARY_HOURLY_CRON || "0 * * * *", id: "summaries-hourly" },
      { event: "generate12h", cron: process.env.SUMMARY_12H_CRON || "0 0,12 * * *", id: "summaries-12h" },
      { event: "generateDaily", cron: process.env.SUMMARY_DAILY_CRON || "0 0 * * *", id: "summaries-daily" },
    ];
    for (const { event, cron, id } of summaryCrons) {
      try {
        await myQueue.add(
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

  // ---- Express HTTP server (health/status probes) ----
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => res.send(`worker v${packageJson.version}`));

  app.get("/status", async (_req, res) => {
    if (_req.headers["x-forwarded-for"] || _req.headers["x-forwarded-host"]) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const counts = await myQueue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "paused");
      res.json({ status: "ok", queue: QUEUE_NAME, counts, time: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ status: "error", error: err?.message || String(err) });
    }
  });

  app.get("/version", (_req, res) => res.json({ name: packageJson.name, version: packageJson.version, port: PORT }));

  app.get("/healthz", async (_req, res) => {
    try {
      await myQueue.getWaitingCount();
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
      server.close();
      closeSocket();
      await bullWorker.close();
      await myQueue.close();
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
