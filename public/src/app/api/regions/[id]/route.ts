import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/regions/[id] — one full region record (keyed by `regionId`), its
 * latest bbox-averaged area-weather snapshot and the recent snapshot history
 * for the detail page's trend charts. Mirrors /api/countries/[id].
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const regionId = decodeURIComponent(id);
  try {
    const db = await getAppDb();
    const region = await db.regions.get(regionId);
    if (!region) {
      return NextResponse.json({ error: "region not found" }, { status: 404, headers: NO_CACHE });
    }
    const [weather, history] = await Promise.all([
      db.areaWeatherReports.latest("region", regionId),
      db.areaWeatherReports.list("region", regionId, { limit: 72 }),
    ]);
    return NextResponse.json({ region, weather, history }, { status: 200, headers: NO_CACHE });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502, headers: NO_CACHE });
  }
}
