import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/ads/exposure — the per-ad ticker-exposure rollup for the
 * /admin/ads list: cumulative time each ad's "Sponsored by …" mention has been
 * in the crawl, plus which scenes it is airing on RIGHT NOW (named, so the UI
 * can say where). Windows are written by the worker's ads.exposure sweep.
 */
async function GET__impl() {
  try {
    const db = await getAppDb();
    const [totals, scenes] = await Promise.all([
      db.adExposures.totalsByAd("ticker"),
      db.listScenes(),
    ]);
    const nameOf = new Map(scenes.map((s: { id: string; name: string }) => [s.id, s.name]));
    const out: Record<string, { ms: number; liveScenes: { id: string; name: string }[] }> = {};
    for (const [adId, t] of Object.entries(totals)) {
      out[adId] = {
        ms: t.ms,
        liveScenes: t.liveScenes.map((id) => ({ id, name: nameOf.get(id) ?? id })),
      };
    }
    return NextResponse.json({ totals: out }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err), totals: {} }, { status: 502, headers: NO_CACHE });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
