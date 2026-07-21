import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/streams/:id/key — the RTMP ingestion address + stream key for MANUAL
 * OBS handoff (when OBS automation is unavailable). Admin-only and deliberately
 * separate from the run's general state: the stream key is a secret and never
 * rides the socket (see toRunState), so this is the one place it is exposed.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const run = await db.getRun(id);
  const yt = run?.platforms?.youtube;
  if (!run || !yt?.ingestionAddress || !yt.streamName) {
    return NextResponse.json({ error: "no stream key for this run" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json(
    { ingestionAddress: yt.ingestionAddress, streamName: yt.streamName },
    { status: 200, headers: NO_CACHE },
  );
}

export const GET = withApiLog(GET__impl);
