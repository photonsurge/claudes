import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/ads/[adId]/exposure — one ad's ticker log, newest first:
 * every window its "Sponsored by …" mention has aired, as {scene, start, end,
 * duration} with scene names resolved (an open window has no `endedAt` — it's
 * on air right now). No cap: the whole history, windows are rare events.
 */
async function GET__impl(
  _req: Request,
  { params }: { params: Promise<{ adId: string }> },
) {
  const { adId } = await params;
  try {
    const db = await getAppDb();
    const [windows, scenes] = await Promise.all([
      db.adExposures.listForAd(decodeURIComponent(adId), "ticker"),
      db.listScenes(),
    ]);
    const nameOf = new Map(scenes.map((s: { id: string; name: string }) => [s.id, s.name]));
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
