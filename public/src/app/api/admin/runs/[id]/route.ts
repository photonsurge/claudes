import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/runs/:id — one as-run session plus its full cut timeline, in
 * air order. Backs the /admin/runs/:id review page.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getAppDb();
  const run = await db.airLog.getRun(id);
  if (!run) {
    return NextResponse.json({ error: "no such run" }, { status: 404, headers: NO_CACHE });
  }
  const [entries, scenes] = await Promise.all([db.airLog.listEntries(id), db.listScenes()]);
  const sceneName = scenes.find((s) => s.id === run.sceneId)?.name ?? run.sceneId;
  return NextResponse.json({ run, entries, sceneName }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
