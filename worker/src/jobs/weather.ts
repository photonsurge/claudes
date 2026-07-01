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
import { ingestIconD2 } from "../weather/iconD2";
import { ingestHrrr } from "../weather/hrrr";
import { ingestMrms } from "../weather/mrms";
import { ingestWaveNests } from "../weather/waveNests";
import { ingestRtofsRegional } from "../weather/rtofsRegional";

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

// ── Phase 2 regional NESTS (zoom-gated high-res overlays) ─────────────────────
/** DWD ICON-D2 2.2 km Europe (temp/wind/gust) — see ../weather/iconD2.ts */
export async function refreshIconD2(_job: Job) {
  return ingestIconD2();
}

/** NOAA HRRR 3 km CONUS (temp/wind/gust) — see ../weather/hrrr.ts */
export async function refreshHrrr(_job: Job) {
  return ingestHrrr();
}

/** NOAA MRMS radar CONUS (reflectivity) — see ../weather/mrms.ts */
export async function refreshMrms(_job: Job) {
  return ingestMrms();
}

/** GFS-Wave basin nests (finer 0.16° regional wave grids) — see ../weather/waveNests.ts */
export async function refreshWaveNests(_job: Job) {
  return ingestWaveNests();
}

/** RTOFS regional ocean windows (sst/current/salinity) — see ../weather/rtofsRegional.ts */
export async function refreshRtofsRegional(_job: Job) {
  return ingestRtofsRegional();
}
