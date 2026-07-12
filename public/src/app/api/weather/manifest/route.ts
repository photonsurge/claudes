import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { MANIFEST_CACHE_KEY } from "@photonsurge/shared/manifest";
import { composeManifest } from "../../../../lib/manifest";
import { withCache, FEED_TTL_SEC } from "../../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/**
 * GET /api/weather/manifest — the multi-supplier portfolio composed into ONE
 * client manifest: the latest published run of each model (gfs/ifs/rtofs/
 * gfswave-mosaic), with each variable served by its highest-priority source.
 * Returns `{run:null}` when nothing is published.
 *
 * Redis result-cache (withCache): the composed manifest is identical for every
 * client until a new run publishes, so one Mongo read + compose per FEED_TTL_SEC
 * serves the whole broadcast instead of one per request (every watch/scene/OBS
 * source + the cold-start fetch). Runs are hours apart, so the short hold barely
 * lags a publish. Fail-open — a Redis outage degrades to a live compose.
 */
async function GET__impl() {
  const { value, hit } = await withCache(MANIFEST_CACHE_KEY, FEED_TTL_SEC, async () => {
    const db = await getAppDb();
    const runs = await db.latestPublishedRunsByModel();
    return composeManifest(runs) ?? { run: null };
  });
  return NextResponse.json(value, {
    status: 200,
    headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" },
  });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
