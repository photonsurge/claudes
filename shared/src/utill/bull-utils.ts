// Three BullMQ queues, split by resource weight so heavy jobs can't starve light
// ones or OOM the worker. Each tier is a separate queue consumed by its own Worker
// with its own concurrency (see worker/src/index.ts + bull.ts TIER_CONCURRENCY).
//
//  - background: heavy CPU/memory (weather bakes, reproject, the alert dissolve,
//    satellite imagery). LOW concurrency — this cap is what bounds peak heap and
//    stopped the 4GB OOM.
//  - foreground: latency-sensitive, broadcast-facing (the director, health pings).
//    Never queued behind a big bake.
//  - mid: everything else — normal cron ingest. The default when a type isn't
//    explicitly classified.
export type QueueTier = "foreground" | "mid" | "background";

export const QUEUE_TIERS: readonly QueueTier[] = ["foreground", "mid", "background"];

/** The historical single queue kept its name as the MID tier, so existing Redis
 * schedules and every `getQueue().client` reader carry on unchanged. */
export const QUEUE_NAME = "worker-app";

export const QUEUE_NAMES: Record<QueueTier, string> = {
  foreground: "worker-app-fg",
  mid: QUEUE_NAME,
  background: "worker-app-bg",
};

/**
 * Per-tier Worker concurrency. Tuned off the live /status per-event memory table:
 * the biggest heap-deltas were MID-tier ingests (cams ~171MB, tracks ~136MB), not
 * the background bakes (sampled ~80MB), so MID is the tighter cap. Both are
 * env-overridable per tier (WORKER_CONCURRENCY_{FG,MID,BG}); watch rssPeakMB on
 * /status after changing background — a big ICON-D2 grid can spike well past the
 * sample.
 */
export const TIER_CONCURRENCY: Record<QueueTier, number> = {
  foreground: 2,
  mid: 2,
  background: 4,
};

export const DEFAULT_TIER: QueueTier = "mid";

// Job TYPES that are NOT the default (mid) tier. Anything absent falls to mid.
const BACKGROUND_TYPES = new Set<string>([
  "weather", // GFS/ICON/HRDPS/HRRR/RTOFS/waves — decode + reproject + bake, the memory hog
  "alertBlobs", // the polygon dissolve
  "satimg", // satellite imagery (sharp)
  "aurora", // OVATION raster bake
  "geomag", // magnetic-field raster bake
  "areaWeather", // polygon-masked area weather
  "climate", // all-city climate backfill
]);

const FOREGROUND_TYPES = new Set<string>([
  "director", // broadcast sequencer — must never wait behind a bake
  "ping", // health / liveness
]);

/** Which tier a job type runs on. Explicit `sendToFore/Mid/Back` override this. */
export const queueForType = (type: string): QueueTier => {
  if (BACKGROUND_TYPES.has(type)) return "background";
  if (FOREGROUND_TYPES.has(type)) return "foreground";
  return DEFAULT_TIER;
};
