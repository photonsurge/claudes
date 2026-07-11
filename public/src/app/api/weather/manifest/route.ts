import { getAppDb } from "@photonsurge/shared/db/index";
import { composeManifest } from "../../../../lib/manifest";
import { cachedJson } from "../../../../lib/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/weather/manifest — the multi-supplier portfolio composed into ONE
 * client manifest: the latest published run of each model (gfs/ifs/rtofs/
 * gfswave-mosaic), with each variable served by its highest-priority source.
 * Returns `{run:null}` when nothing is published.
 *
 * The composed manifest is identical for every client until a new run
 * publishes, so it's cached in Redis for a short TTL: one Mongo read + compose
 * per TTL serves the whole broadcast instead of one per request. Runs are hours
 * apart, so the few seconds of staleness after a publish are invisible.
 */
export async function GET() {
  return cachedJson("weather:manifest:v1", 20, async () => {
    const db = await getAppDb();
    const runs = await db.latestPublishedRunsByModel();
    return composeManifest(runs) ?? { run: null };
  });
}
