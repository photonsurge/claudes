import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { runsOverlapping } from "@photonsurge/shared/vod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/runs/:id — one as-run session plus its full cut timeline, in
 * air order, and the streaming runs (YouTube videos) whose on-air span overlaps
 * it, so the page can link "aired on ▸". Backs the /admin/runs/:id review page.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getAppDb();
  const run = await db.airLog.getRun(id);
  if (!run) {
    return NextResponse.json({ error: "no such run" }, { status: 404, headers: NO_CACHE });
  }
  const [entries, scenes, sceneRuns] = await Promise.all([
    db.airLog.listEntries(id),
    db.listScenes(),
    db.listRuns({ sceneId: run.sceneId }),
  ]);
  const sceneName = scenes.find((s) => s.id === run.sceneId)?.name ?? run.sceneId;
  const fromMs = new Date(run.startedAt).getTime();
  const toMs = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
  const videos = runsOverlapping(sceneRuns, fromMs, toMs).map((r) => ({
    id: r.id,
    title: r.title ?? null,
    status: r.status,
    watchUrl: r.platforms?.youtube?.watchUrl ?? null,
    startAt: r.startAt ?? null,
    endedAt: r.endedAt ?? null,
  }));
  return NextResponse.json({ run, entries, sceneName, videos }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
