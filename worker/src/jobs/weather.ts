// jobs/weather.ts
// Weather ingest pipeline handlers. The worker loader registers EVERY exported
// function in this file as a job handler, so ONLY the three real handlers
// (check / ingest / seedSample) are exported. All implementation lives in
// ../weather/* (check / ingest / seed), ../sources and ../grib.

import type { Job } from "bullmq";

import { runCheck } from "../weather/check";
import { runIngest } from "../weather/ingest";
import { runSeedSample } from "../weather/seed";
import { ingestIfs, ingestRtofs, ingestWaveMosaic } from "../weather/multiSource";

/** See ../weather/check.ts */
export async function check(job: Job) {
  return runCheck(job);
}

/** See ../weather/ingest.ts */
export async function ingest(job: Job) {
  return runIngest(job);
}

/** See ../weather/seed.ts */
export async function seedSample(job: Job) {
  return runSeedSample(job);
}

// ── Multi-supplier ingests (each idempotent: skips if already published) ──────
/** ECMWF IFS atmospheric base — see ../weather/multiSource.ts */
export async function refreshIfs(_job: Job) {
  return ingestIfs();
}

/** NOAA RTOFS ocean (SST/currents/salinity) — see ../weather/multiSource.ts */
export async function refreshRtofs(_job: Job) {
  return ingestRtofs();
}

/** GFS-Wave regional mosaic — see ../weather/multiSource.ts */
export async function refreshWaves(_job: Job) {
  return ingestWaveMosaic();
}
