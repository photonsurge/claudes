import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { normaliseSeaPoint } from "@photonsurge/shared/sea-points/normalise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/sea-points
 * The full ocean-monitoring-point catalog the `ocean` Director kind draws
 * candidates from (worker/src/director/candidates.ts) — admin sees disabled
 * points too, unlike the worker's own `.filter((p) => p.enabled)` read.
 */
async function GET__impl() {
  try {
    const db = await getAppDb();
    const seaPoints = await db.seaPoints.list();
    return NextResponse.json({ count: seaPoints.length, seaPoints }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), seaPoints: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}

/**
 * POST /api/admin/sea-points — create/update one sea point from manual admin
 * entry. The body is validated + canonicalised by `normaliseSeaPoint`; an
 * unusable record (missing name or an out-of-range coordinate) is rejected
 * with 400. Upserts on `pointId`, so re-posting the same id edits it.
 */
async function POST__impl(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_CACHE });
  }

  const seaPoint = normaliseSeaPoint(body);
  if (!seaPoint) {
    return NextResponse.json(
      { error: "sea point needs a name and valid lat/lng" },
      { status: 400, headers: NO_CACHE },
    );
  }

  try {
    const db = await getAppDb();
    const saved = await db.seaPoints.upsertOne(seaPoint);
    return NextResponse.json({ seaPoint: saved }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
