import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { TrackSnapshotKind } from "@photonsurge/shared/db/track-snapshot-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/tracks/history/paths?minutes=30&kind=aircraft|ship
 * Per-track trailing paths over the last N minutes — one polyline per track,
 * positions oldest→newest. The source for the live "trails" overlay on the
 * globe. Aggregated server-side so the response is one line per track, not
 * every recorded frame.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const minRaw = Number(url.searchParams.get("minutes"));
  const minutes = Number.isFinite(minRaw) && minRaw > 0 ? Math.min(minRaw, 360) : 30;
  const kind = (url.searchParams.get("kind") as TrackSnapshotKind | null) ?? undefined;
  const from = new Date(Date.now() - minutes * 60 * 1000);

  try {
    const db = await getAppDb();
    const paths = await db.trackSnapshots.paths({ from, kind });
    return NextResponse.json(
      { minutes, count: paths.length, paths },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), paths: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
