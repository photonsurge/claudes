import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { runIsActive } from "@photonsurge/shared/runs";
import { loadAsRunTimeline, vodLeadMsFromEnv } from "@photonsurge/shared/vod-bundle";
import { withCache } from "../../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
/** A finished video's timeline is fixed; viewers arriving from the description share one read. */
const FINISHED_TTL_SEC = 300;

/**
 * GET /api/vod/:videoId — PUBLIC (no auth): what aired during one YouTube
 * video, at video offsets, keyed by the video id viewers actually have (the
 * broadcast id). Backs /vod/:videoId, linked from every video's description.
 * Deliberately secret-free: title, scene, status, span, watch URL and the
 * director's cuts — no run internals (encoder, slot, keys, chat, sessions).
 * Same shared loader as the admin page, so the two never disagree.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  const db = await getAppDb();
  const run = await db.getRunByBroadcastId(videoId);
  if (!run?.platforms?.youtube?.broadcastId) {
    return NextResponse.json({ error: "no such video" }, { status: 404, headers: NO_CACHE });
  }
  const live = runIsActive(run.status);
  const leadMs = vodLeadMsFromEnv();
  const build = async () => {
    const scenes = await db.listScenes();
    const { window, kindCounts, items } = await loadAsRunTimeline(db.airLog, run, { leadMs });
    return {
      title: run.title ?? null,
      sceneName: scenes.find((s) => s.id === run.sceneId)?.name ?? run.sceneId,
      status: run.status,
      startAt: run.startAt ?? null,
      endedAt: run.endedAt ?? null,
      video: { id: run.platforms.youtube!.broadcastId!, watchUrl: run.platforms.youtube?.watchUrl ?? null },
      window,
      kindCounts,
      items,
    };
  };
  // Live: every poll must see the latest cut. Finished: the timeline is fixed.
  const bundle = live ? await build() : (await withCache(`vod:${videoId}:${leadMs}`, FINISHED_TTL_SEC, build)).value;
  return NextResponse.json(bundle, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
