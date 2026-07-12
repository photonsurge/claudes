import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/runs?sceneId=&limit= — director as-run sessions, newest first
 * (all of them unless a limit is asked for). Scene display names ride along so
 * the list can label runs without a second fetch.
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);
  const sceneId = url.searchParams.get("sceneId") || undefined;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  const db = await getAppDb();
  const [runs, scenes] = await Promise.all([db.airLog.listRuns({ sceneId, limit }), db.listScenes()]);
  const sceneNames: Record<string, string> = {};
  for (const s of scenes) sceneNames[s.id] = s.name;
  return NextResponse.json({ runs, sceneNames, count: runs.length }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
