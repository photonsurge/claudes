import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { AD_EXPOSURE_SURFACES } from "@photonsurge/shared/db/ad-exposure-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/ads/exposure — the per-ad exposure rollup for the /admin/ads
 * list: cumulative time each ad has been on an always-on surface (the crawl's
 * "Sponsored by …" mention, the bottom-left billboard rotation and the New
 * alerts card's sponsor turns, summed),
 * plus which scenes it is airing on RIGHT NOW (named, so the UI can say
 * where). Windows are written by the worker's ads.exposure sweep; the
 * per-surface split lives in the per-ad exposure log.
 */
async function GET__impl() {
  try {
    const db = await getAppDb();
    const scenes = await db.listScenes();
    const perSurface = await Promise.all(AD_EXPOSURE_SURFACES.map((s) => db.adExposures.totalsByAd(s)));
    const nameOf = new Map(scenes.map((s: { id: string; name: string }) => [s.id, s.name]));
    const out: Record<string, { ms: number; liveScenes: { id: string; name: string }[] }> = {};
    for (const totals of perSurface) {
      for (const [adId, t] of Object.entries(totals)) {
        const merged = (out[adId] ??= { ms: 0, liveScenes: [] });
        merged.ms += t.ms;
        for (const id of t.liveScenes) {
          if (!merged.liveScenes.some((s) => s.id === id)) {
            merged.liveScenes.push({ id, name: nameOf.get(id) ?? id });
          }
        }
      }
    }
    return NextResponse.json({ totals: out }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err), totals: {} }, { status: 502, headers: NO_CACHE });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
