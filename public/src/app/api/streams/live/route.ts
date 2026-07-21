import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/streams/live — PUBLIC (no auth) minimal live-run status, so the
 * anonymous home-page ON-AIR badge can cold-start (the admin /api/streams can't
 * serve public viewers). Deliberately tiny + secret-free: scene, status, title,
 * and the public YouTube watch URL only — no stream key, no ingestion address.
 */
async function GET__impl() {
  const db = await getAppDb();
  const runs = await db.listRuns({ status: ["live", "awaiting-ingest"] });
  return NextResponse.json(
    {
      runs: runs.map((r) => ({
        sceneId: r.sceneId,
        status: r.status,
        title: r.title ?? null,
        watchUrl: r.platforms?.youtube?.watchUrl ?? null,
        startAt: r.startAt ?? null,
      })),
    },
    { status: 200, headers: NO_CACHE },
  );
}

export const GET = withApiLog(GET__impl);
