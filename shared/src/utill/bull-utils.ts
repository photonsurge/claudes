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
 * Per-tier Worker concurrency. Tuned off the live /status per-event memory table
 * + host headroom: with Mongo's WiredTiger cache capped to 1GB (docker-compose),
 * there's RAM to run BACKGROUND wider (4) — that's where the heavy hogs (alerts,
 * tracks, bakes) now live and where throughput matters. MID (3) runs the light
 * cron ingests; FOREGROUND (2) stays tightest, latency-work that mustn't fan out.
 * All env-overridable per tier (WORKER_CONCURRENCY_FOREGROUND / _MID / _BACKGROUND);
 * watch rssPeakMB on /status after raising background — a big ICON-D2 grid + an
 * alerts.ingest can spike well past the sample.
 */
export const TIER_CONCURRENCY: Record<QueueTier, number> = {
  foreground: 2,
  mid: 3,
  background: 4,
};

export const DEFAULT_TIER: QueueTier = "mid";

// Job TYPES that are NOT the default (mid) tier. Anything absent falls to mid.
//
// Classified off the LIVE /status per-event peak-heap table, not by guesswork: the
// real hogs were `alerts` (ingest:wmo +765MB, snapshotSatellite +256MB) and
// `tracks` (enrichAircraft +743MB, snapshotShips +254MB) — both defaulting into
// mid, where four could co-run and spike rss to ~3.4GB. The weather BAKES, by
// contrast, are ~30MB each. So heaviness ≠ "is a bake"; it's whatever the ledger
// says. Keep this list honest against /status.
const BACKGROUND_TYPES = new Set<string>([
  "weather", // GFS/ICON/HRDPS/HRRR/RTOFS/waves — decode + reproject + bake
  "alertBlobs", // the polygon dissolve
  "alerts", // ingest + satellite/camera snapshots — the single biggest heap hog (+765MB)
  "tracks", // aircraft enrichment + position snapshots (+743MB); not latency-critical
  "satimg", // satellite imagery (sharp)
  "aurora", // OVATION raster bake
  "geomag", // magnetic-field raster bake
  "areaWeather", // polygon-masked area weather
  "climate", // all-city climate backfill
  "basemap", // full-globe basemap texture download + full-decode validation (sharp)
]);

const FOREGROUND_TYPES = new Set<string>([
  "director", // broadcast sequencer — must never wait behind a bake
  "ping", // health / liveness
  "run-lifecycle", // live-stream go-live/stop/confirm/heartbeat — operator-facing, latency-sensitive
  "youtube", // OAuth code exchange + connection check — an operator is waiting on the answer
]);

/** Which tier a job type runs on. Explicit `sendToFore/Mid/Back` override this. */
export const queueForType = (type: string): QueueTier => {
  if (BACKGROUND_TYPES.has(type)) return "background";
  if (FOREGROUND_TYPES.has(type)) return "foreground";
  return DEFAULT_TIER;
};
