import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { AD_EXPOSURE_SURFACES } from "@photonsurge/shared/db/ad-exposure-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/ads/[adId]/exposure — one ad's exposure log, newest first:
 * every window it has aired on an always-on surface (the crawl's "Sponsored
 * by …" mention and the bottom-left billboard rotation, each row tagged with
 * its `surface`), as {scene, start, end, duration} with scene names resolved
 * (an open window has no `endedAt` — it's on air right now). No cap: the
 * whole history, windows are rare events.
 */
async function GET__impl(
  _req: Request,
  { params }: { params: Promise<{ adId: string }> },
) {
  const { adId } = await params;
  try {
    const db = await getAppDb();
    const id = decodeURIComponent(adId);
    const scenes = await db.listScenes();
    const lists = await Promise.all(AD_EXPOSURE_SURFACES.map((s) => db.adExposures.listForAd(id, s)));
    const nameOf = new Map(scenes.map((s: { id: string; name: string }) => [s.id, s.name]));
    const windows = AD_EXPOSURE_SURFACES.flatMap((surface, i) => lists[i].map((w) => ({ ...w, surface })))
      .sort((a, b) => b.startedAt - a.startedAt);
    return NextResponse.json(
      {
        count: windows.length,
        windows: windows.map((w) => ({ ...w, sceneName: nameOf.get(w.sceneId) ?? w.sceneId })),
      },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), windows: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
