// weather/manifestCache.ts
// Drop the public manifest Redis cache when a run publishes, so the map reflects
// a freshly baked run immediately instead of lagging up to FEED_CACHE_TTL_SEC
// (10 min) — the reason a completed GFS bake didn't appear on the globe until the
// cache expired. The worker and the public route share ONE Redis (the BullMQ
// ioredis instance), so the worker can delete the key directly. Fail-open: a
// bust failure must never fail an already-published run.

import { getQueue } from "@photonsurge/shared/bull/bull";
import { MANIFEST_CACHE_KEY } from "@photonsurge/shared/manifest";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "job:weather";

/** Delete the composed-manifest cache key. Never throws. */
export async function bustManifestCache(): Promise<void> {
  try {
    // Queue.client resolves to the shared ioredis instance (same as focus-cache).
    const redis = await getQueue().client;
    await redis.del(MANIFEST_CACHE_KEY);
    log(TAG, "manifest cache busted", { key: MANIFEST_CACHE_KEY });
  } catch (err) {
    log(TAG, "manifest cache bust failed (non-fatal)", { err: String(err) });
  }
}
