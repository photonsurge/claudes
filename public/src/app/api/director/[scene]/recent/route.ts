import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/director/:scene/recent?limit= — the scene's most-recently-aired
 * shots from the durable as-run log (AirEntry), newest-first. Backs the
 * /control "Recently aired" glance so it matches /admin/runs, survives reloads,
 * and never misses a cut — unlike the old client-only session tracker it
 * replaces, which only saw cuts while the page was open. (The glance links out
 * to /admin/runs — the full list of sessions — for the complete history.)
 */
async function GET__impl(req: Request, { params }: { params: Promise<{ scene: string }> }) {
  const { scene } = await params;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, limitRaw) : 12;

  const db = await getAppDb();
  const entries = await db.airLog.recentEntries({ sceneId: scene, limit });
  return NextResponse.json({ entries }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
