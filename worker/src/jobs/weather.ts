// jobs/weather.ts
// Weather ingest pipeline handlers. The worker loader registers EVERY exported
// function in this file as a job handler, so ONLY the three real handlers
// (check / ingest / seedSample) are exported. All implementation lives in
// ../weather/* (check / ingest / seed), ../sources and ../grib.

import type { Job } from "bullmq";

import { runCheck } from "../weather/check";
import { runIngest } from "../weather/ingest";
import { runSeedSample } from "../weather/seed";

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
