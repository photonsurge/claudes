import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

/**
 * GET /api/cities/weather?bbox=west,south,east,north&limit=10 — the biggest
 * cities inside the framed area, population-ranked, each with its worker-cached
 * current conditions + 3-day daily forecast (see worker/src/jobs/cityWeather.ts).
 * Drives the on-air "CITY CONDITIONS" slide of a country spotlight / round-up.
 * Empty (not an error) without a valid bbox — the slide just hides itself.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const parts = (sp.get("bbox") ?? "").split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    return NextResponse.json({ cities: [] }, { status: 200, headers: NO_CACHE });
  }
  const limit = Math.min(Math.max(Number(sp.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const db = await getAppDb();
  const rows = await db.cityWeather.topByBbox(parts as [number, number, number, number], limit);
  const cities = rows.map((r) => ({
    cityId: r.cityId,
    name: r.name,
    cc: r.cc,
    lat: r.lat,
    lng: r.lng,
    population: r.population,
    current: r.current,
    daily: r.daily,
    updatedAt: r.updatedAt,
  }));
  return NextResponse.json({ cities, count: cities.length }, { status: 200, headers: NO_CACHE });
}
