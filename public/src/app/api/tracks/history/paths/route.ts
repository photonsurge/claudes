import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { TrackSnapshotKind } from "@photonsurge/shared/db/track-snapshot-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/tracks/history/paths?minutes=30&kind=aircraft|ship&ids=abc,def
 * Per-track trailing paths over the last N minutes — one polyline per track,
 * positions oldest→newest. The source for the live "trails" overlay on the
 * globe. Aggregated server-side so the response is one line per track, not
 * every recorded frame.
 *
 * `ids` scopes to a specific set of tracks (the overlay sends the on-air +
 * notable craft). A present-but-empty `ids` means "nothing to trail" — the
 * client only asks for the routes it will actually draw, not the whole planet.
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);
  const minRaw = Number(url.searchParams.get("minutes"));
  const minutes = Number.isFinite(minRaw) && minRaw > 0 ? Math.min(minRaw, 360) : 30;
  const kind = (url.searchParams.get("kind") as TrackSnapshotKind | null) ?? undefined;
  const idsRaw = url.searchParams.get("ids");
  const ids =
    idsRaw != null
      ? idsRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : undefined;
  const from = new Date(Date.now() - minutes * 60 * 1000);

  // Scoped to an empty set → nothing to draw; skip the aggregation entirely.
  if (ids && ids.length === 0) {
    return NextResponse.json({ minutes, count: 0, paths: [] }, { status: 200, headers: NO_CACHE });
  }

  try {
    const db = await getAppDb();
    const paths = await db.trackSnapshots.paths({ from, kind, ids });
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

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
