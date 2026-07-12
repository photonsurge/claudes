import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/countries/[id] — one full country record (keyed by `countryId`,
 * e.g. "gb"), its latest area-weather snapshot and the recent snapshot history
 * for the detail page's trend charts. Mirrors /api/cities/[id].
 */
async function GET__impl(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const countryId = decodeURIComponent(id);
  try {
    const db = await getAppDb();
    const country = await db.countries.get(countryId);
    if (!country) {
      return NextResponse.json({ error: "country not found" }, { status: 404, headers: NO_CACHE });
    }
    const [weather, history] = await Promise.all([
      db.areaWeatherReports.latest("country", countryId),
      db.areaWeatherReports.list("country", countryId, { limit: 72 }),
    ]);
    return NextResponse.json({ country, weather, history }, { status: 200, headers: NO_CACHE });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502, headers: NO_CACHE });
  }
}

/**
 * PATCH /api/countries/[id] — toggle a country's 12h AI round-up opt-in
 * (`roundupEnabled`). Body: `{ roundupEnabled: boolean }`. The round-up job's
 * work-list is exactly the enabled set.
 */
async function PATCH__impl(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const countryId = decodeURIComponent(id);
  try {
    const body = (await req.json().catch(() => ({}))) as { roundupEnabled?: unknown };
    if (typeof body.roundupEnabled !== "boolean") {
      return NextResponse.json({ error: "roundupEnabled (boolean) required" }, { status: 400, headers: NO_CACHE });
    }
    const db = await getAppDb();
    const country = await db.countries.get(countryId);
    if (!country) {
      return NextResponse.json({ error: "country not found" }, { status: 404, headers: NO_CACHE });
    }
    await db.countries.setRoundupEnabled(countryId, body.roundupEnabled);
    return NextResponse.json({ countryId, roundupEnabled: body.roundupEnabled }, { status: 200, headers: NO_CACHE });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502, headers: NO_CACHE });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const PATCH = withApiLog(PATCH__impl);
