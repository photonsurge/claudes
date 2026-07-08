import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/countries
 * Reads the worker-seeded Country catalog from Mongo — the public app never
 * parses countries.geojson directly. Each country carries its latest
 * area-weather report (if the hourly job has run yet) inlined as `weather`,
 * so the admin table needs one fetch, not two.
 */
export async function GET() {
  try {
    const db = await getAppDb();
    const [countries, reports] = await Promise.all([
      db.countries.list(),
      db.areaWeatherReports.latestByKind("country"),
    ]);
    const reportByPlace = new Map(reports.map((r) => [r.placeId, r]));
    const withWeather = countries.map((c) => ({ ...c, weather: reportByPlace.get(c.countryId) ?? null }));
    return NextResponse.json(
      { count: withWeather.length, countries: withWeather },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), countries: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
