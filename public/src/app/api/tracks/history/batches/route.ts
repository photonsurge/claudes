import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { TrackSnapshotKind } from "@photonsurge/shared/db/track-snapshot-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/tracks/history/batches?hours=6&kind=aircraft|ship
 * The available replay-frame timestamps (newest first) in the last N hours — the
 * scrubber's tick marks.
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);
  const hoursRaw = Number(url.searchParams.get("hours"));
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 168) : 6;
  const kind = (url.searchParams.get("kind") as TrackSnapshotKind | null) ?? undefined;

  const from = new Date(Date.now() - hours * 60 * 60 * 1000);

  const db = await getAppDb();
  const batches = await db.trackSnapshots.batches({ from, kind, limit: 1000 });
  return NextResponse.json(
    { hours, count: batches.length, batches },
    { status: 200, headers: NO_CACHE },
  );
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
