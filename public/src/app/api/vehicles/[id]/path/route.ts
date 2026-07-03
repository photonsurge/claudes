import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/vehicles/[id]/path — the persistent breadcrumb ("route") for a flagged
 * vehicle: ordered [{lng,lat,t}] points, oldest→newest, spanning far beyond the
 * live feed's 6h window. Empty for craft that aren't flagged (only notable craft
 * accrue a trail). Returns a GeoJSON-ready line + the raw points.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const db = await getAppDb();
    const points = await db.vehicles.route(decodeURIComponent(id));
    return NextResponse.json(
      {
        id: decodeURIComponent(id),
        count: points.length,
        points,
        line: points.map((p) => [p.lng, p.lat]),
      },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}
