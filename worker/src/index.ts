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
import { getDb, closeDb } from "@photonsurge/shared/utill/mongoose";
import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";
import { WorkerBackLogger } from "@photonsurge/shared/utill/BackLogger";

import { initSocket, closeSocket } from "./socket";
import { startDirector, stopDirector } from "./director/loop";
import { startSeismoStream, stopSeismoStream } from "./seismo/loop";
import { WEATHER_SOURCE_JOBS, jobEveryMs } from "./weather/sourceSchedule";
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

  // Live seismograph: a persistent SeedLink TCP connection to the stations
  // nearest what's on air, not a BullMQ job — the connection must stay open
  // between ticks. Disable with SEISMO_ENABLED=false.
  if (process.env.SEISMO_ENABLED !== "false") startSeismoStream();

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
    // Process up to WORKER_CONCURRENCY jobs at once (default 10). Downloads are still
    // throttled process-wide by nomadsGate() and CPU bakes by bakePool, so raising
    // this mostly lets independent ingests/snapshots overlap instead of queueing.
    {
      connection: { ...getRedisOptions(), maxRetriesPerRequest: null },
      concurrency: Number(process.env.WORKER_CONCURRENCY || 10),
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
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
    // The ingest fleet lives in one shared list (weather/sourceSchedule.ts) so the
    // reset script re-kicks exactly what the scheduler registers — no drift.
    // Only schedule ENABLED sources (IFS is off by default until CCSDS-validated).
    for (const job of WEATHER_SOURCE_JOBS.filter((j) => getSource(j.sourceId)?.enabled)) {
      const { event } = job;
      const every = jobEveryMs(job);
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

  // ---- Repeatable alerts.translate job ----
  // Own cadence, decoupled from ingest, so a slow LLM call never blocks the poll
  // tick. No-ops (never touches Mongo) when OPENROUTER_API_KEY is unset.
  const ALERTS_TRANSLATE_MS = Number(process.env.ALERTS_TRANSLATE_MS || 15 * 60 * 1000);
  try {
    await myQueue.add(
      "do",
      { domain: "alerts", type: "alerts", event: "translate", data: {} },
      { repeat: { every: ALERTS_TRANSLATE_MS }, jobId: "alerts-translate" },
    );
    log(TAG, `registered repeatable alerts.translate`, { every: ALERTS_TRANSLATE_MS });
  } catch (err) {
    log(TAG, `failed to register alerts.translate`, { err: summarizeForLog(err) });
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
      // Cache photo + blurb onto the notable-tracks catalog. LOW PRIORITY (>0 so
      // it never competes with the live snapshots) and slow (staleness-gated +
      // a tiny catalog), so it barely touches the keyless services.
      await myQueue.add(
        "do",
        { domain: "notable", type: "notable", event: "enrichNotable", data: {} },
        {
          repeat: { every: Number(process.env.NOTABLE_ENRICH_MS || 3_600_000), immediately: true },
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

  // ---- Repeatable aurora.refresh (SWPC OVATION oval → baked glow PNG → Mongo) ----
  // The auroral oval moves with geomagnetic activity; SWPC republishes every few
  // minutes, so refresh on a fast cron (5 min by default). A fixed jobId de-dups
  // across restarts; `immediately` seeds the cache at boot so a fresh DB shows the
  // oval right away. Disable with AURORA_REFRESH_ENABLED=false.
  if (process.env.AURORA_REFRESH_ENABLED !== "false") {
    const AURORA_REFRESH_MS = Number(process.env.AURORA_REFRESH_MS || 5 * 60 * 1000);
    try {
      await myQueue.add(
        "do",
        { domain: "aurora", type: "aurora", event: "refresh", data: {} },
        { repeat: { every: AURORA_REFRESH_MS, immediately: true }, jobId: "aurora-refresh" },
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
      await myQueue.add(
        "do",
        { domain: "fires", type: "fires", event: "snapshot", data: {} },
        { repeat: { every: FIRE_SNAPSHOT_MS, immediately: true }, jobId: "fires-snapshot" },
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
      await myQueue.add(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "snapshot", data: {} },
        { repeat: { every: VOLCANO_SNAPSHOT_MS, immediately: true }, jobId: "volcanoes-snapshot" },
      );
      log(TAG, `registered repeatable volcanoes.snapshot`, { everyMs: VOLCANO_SNAPSHOT_MS });
    } catch (err) {
      log(TAG, `failed to register volcanoes.snapshot`, summarizeForLog(err));
    }
  }

  // Cache a Wikipedia photo/gallery + Wikidata facts onto each active volcano.
  // LOW PRIORITY (>0 so it never competes with the live snapshots) and slow
  // (staleness-gated + a tiny catalog), so it barely touches Wikipedia/Wikidata.
  try {
    await myQueue.add(
      "do",
      { domain: "volcanoes", type: "volcanoes", event: "enrichWiki", data: {} },
      {
        repeat: { every: Number(process.env.VOLCANO_ENRICH_MS || 6 * 3_600_000), immediately: true },
        jobId: "volcanoes-enrich",
        priority: 10,
      },
    );
    log(TAG, `registered repeatable volcanoes.enrichWiki`);
  } catch (err) {
    log(TAG, `failed to register volcanoes.enrichWiki`, summarizeForLog(err));
  }

  // LLM-parse each volcano's weekly bulletin text into a couple of structured
  // facts (plume height, VEI) — re-checks every time a fresh bulletin lands
  // (see volcano-repo.ts#listNeedingReportParse), not on a fixed staleness gate,
  // so this can poll fairly often; it's a no-op re-scan when nothing's new.
  // Fully skips (no Mongo writes) when OPENROUTER_API_KEY is unset.
  try {
    await myQueue.add(
      "do",
      { domain: "volcanoes", type: "volcanoes", event: "parseReports", data: {} },
      {
        repeat: { every: Number(process.env.VOLCANO_PARSE_MS || 3_600_000), immediately: true },
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
      await myQueue.add(
        "do",
        { domain: "volcanoes", type: "volcanoes", event: "snapshotUsgs", data: {} },
        {
          repeat: { every: Number(process.env.VOLCANO_USGS_MS || 15 * 60_000), immediately: true },
          jobId: "volcanoes-snapshot-usgs",
        },
      );
      log(TAG, `registered repeatable volcanoes.snapshotUsgs`);
    } catch (err) {
      log(TAG, `failed to register volcanoes.snapshotUsgs`, summarizeForLog(err));
    }
  }

  // ---- Repeatable geomag.refresh (IGRF total-intensity field → baked scalar PNG) ----
  // The geomagnetic field drifts only slowly (secular variation), so re-bake weekly
  // by default. A fixed jobId de-dups across restarts; `immediately` seeds the cache
  // at boot so a fresh DB shows the field right away. Disable with GEOMAG_REFRESH_ENABLED=false.
  if (process.env.GEOMAG_REFRESH_ENABLED !== "false") {
    const GEOMAG_REFRESH_MS = Number(process.env.GEOMAG_REFRESH_MS || 7 * 24 * 60 * 60 * 1000);
    try {
      await myQueue.add(
        "do",
        { domain: "geomag", type: "geomag", event: "refresh", data: {} },
        { repeat: { every: GEOMAG_REFRESH_MS, immediately: true }, jobId: "geomag-refresh" },
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
      await myQueue.add(
        "do",
        { domain: "satimg", type: "satimg", event: "refresh", data: {} },
        { repeat: { every: SATIMG_REFRESH_MS, immediately: true }, jobId: "satimg-refresh" },
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
      await myQueue.add(
        "do",
        { domain: "tides", type: "tides", event: "refreshStations", data: {} },
        { repeat: { every: TIDE_STATIONS_MS, immediately: true }, jobId: "tides-refresh-stations" },
      );
      await myQueue.add(
        "do",
        { domain: "tides", type: "tides", event: "snapshotTides", data: {} },
        { repeat: { every: TIDE_SNAPSHOT_MS }, jobId: "tides-snapshot" },
      );
      log(TAG, `registered repeatable tides.*`, { stationsMs: TIDE_STATIONS_MS, snapshotMs: TIDE_SNAPSHOT_MS });
    } catch (err) {
      log(TAG, `failed to register tides.*`, summarizeForLog(err));
    }
  }

  // ---- Repeatable seismo.refreshStations (GSN broadband-station catalog) ----
  // Near-static reference data (daily); the live SeedLink loop reads it to
  // pick stations near what's on air. `immediately` seeds the catalog at boot
  // so the stream has stations to resolve against right away.
  if (process.env.SEISMO_ENABLED !== "false") {
    const SEISMO_STATIONS_MS = Number(process.env.SEISMO_STATIONS_MS || 24 * 60 * 60 * 1000);
    try {
      await myQueue.add(
        "do",
        { domain: "seismo", type: "seismo", event: "refreshStations", data: {} },
        { repeat: { every: SEISMO_STATIONS_MS, immediately: true }, jobId: "seismo-refresh-stations" },
      );
      log(TAG, `registered repeatable seismo.refreshStations`, { stationsMs: SEISMO_STATIONS_MS });
    } catch (err) {
      log(TAG, `failed to register seismo.refreshStations`, summarizeForLog(err));
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
      await myQueue.add(
        "do",
        { domain: "climate", type: "climate", event: "snapshotClimate", data: {} },
        { repeat: { every: CLIMATE_SNAPSHOT_MS, immediately: true }, jobId: "climate-snapshot" },
      );
      log(TAG, `registered repeatable climate.snapshotClimate`, { snapshotMs: CLIMATE_SNAPSHOT_MS });
    } catch (err) {
      log(TAG, `failed to register climate.snapshotClimate`, summarizeForLog(err));
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
    stopSeismoStream();

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
      closeSocket();
      await bullWorker.close();
      await myQueue.close();
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
