import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { toRunState } from "@photonsurge/shared/runs";
import { loadAsRunTimeline, vodLeadMsFromEnv } from "@photonsurge/shared/vod-bundle";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/streams/:id/asrun — what the director put on air during one
 * streaming run (= one YouTube video), placed at video offsets. The as-run
 * bundle behind /admin/streams/:id (docs/vod-as-run-plan.md).
 *
 * A run and the director log share no key: the join is the run's scene + the
 * video's wall-clock window, done by shared/vod-bundle's loader — the SAME
 * code the worker's chapters job runs, so the page and the video description
 * never disagree. Offsets arrive computed; the page only formats. Admin-only
 * like the rest of the streams surface (the run projection is the secret-free
 * RunState).
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const run = await db.getRun(id);
  if (!run) return NextResponse.json({ error: "no such run" }, { status: 404, headers: NO_CACHE });

  const scenes = await db.listScenes();
  const sceneName = scenes.find((s) => s.id === run.sceneId)?.name ?? run.sceneId;
  const leadMs = vodLeadMsFromEnv();
  const { base, window, sessions, kindCounts, items } = await loadAsRunTimeline(db.airLog, run, { leadMs });
  const yt = run.platforms?.youtube;
  const video = {
    id: yt?.broadcastId ?? null,
    watchUrl: yt?.watchUrl ?? null,
    actualStartTime: yt?.actualStartTime ?? null,
    actualEndTime: yt?.actualEndTime ?? null,
    base,
    leadMs,
  };
  return NextResponse.json(
    { run: toRunState(run), sceneName, video, window, sessions, kindCounts, items },
    { status: 200, headers: NO_CACHE },
  );
}

export const GET = withApiLog(GET__impl);
