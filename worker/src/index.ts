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
import { log } from "@photonsurge/shared/utill/logger";

import { initSocket, closeSocket } from "./socket";
import { getEnabledSources } from "./alerts/registry";
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
        return result;
      } catch (ex) {
        log(TAG, `job:error [${job.id}] ${type}.${event}`, summarizeForLog(ex));
        throw ex;
      }
    },
    // BullMQ requires maxRetriesPerRequest: null on the worker's blocking connection.
    { connection: { ...getRedisOptions(), maxRetriesPerRequest: null }, concurrency: 5, stalledInterval: 30_000, maxStalledCount: 2 },
  );

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

  const shutdown = async (signal: string) => {
    log(TAG, `shutdown requested`, signal);
    try {
      server.close();
      closeSocket();
      await bullWorker.close();
      await myQueue.close();
    } catch (err) {
      log(TAG, `shutdown failed`, summarizeForLog(err));
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})().catch((err) => {
  console.error("[worker] fatal startup error:", err);
  process.exit(1);
});
