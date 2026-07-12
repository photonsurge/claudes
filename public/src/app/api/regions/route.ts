import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/regions
 * Reads the worker-seeded Region catalog (oceans/continents/EU blocs/UK
 * nations) from Mongo, each with its latest area-weather report (if the
 * hourly job has run yet) inlined as `weather`. Mirrors /api/countries.
 */
async function GET__impl() {
  try {
    const db = await getAppDb();
    const [regions, reports] = await Promise.all([
      db.regions.list(),
      db.areaWeatherReports.latestByKind("region"),
    ]);
    const reportByPlace = new Map(reports.map((r) => [r.placeId, r]));
    const withWeather = regions.map((r) => ({ ...r, weather: reportByPlace.get(r.regionId) ?? null }));
    return NextResponse.json(
      { count: withWeather.length, regions: withWeather },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), regions: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
