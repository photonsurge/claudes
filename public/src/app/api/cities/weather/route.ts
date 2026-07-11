import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

/**
 * GET /api/cities/weather — each requested city's worker-cached current
 * conditions + 3-day daily forecast (see worker/src/jobs/cityWeather.ts). Two
 * query shapes, both feeding the on-air weather slides:
 *   • `?bbox=west,south,east,north&limit=10` — the biggest cities inside the
 *     framed area, population-ranked (the "CITY CONDITIONS" spotlight slide).
 *   • `?ids=cityId,cityId,…` — weather for a specific set of cities, used to add
 *     forecasts to the distance-ranked "nearest cities" of a quake / volcano.
 * Empty (not an error) without a valid selector — the slide just hides itself.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const idsParam = sp.get("ids");
  if (idsParam != null) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_LIMIT);
    if (!ids.length) {
      return NextResponse.json({ cities: [] }, { status: 200, headers: NO_CACHE });
    }
    const db = await getAppDb();
    const rows = await db.cityWeather.manyByCityIds(ids);
    return NextResponse.json({ cities: rows.map(toCityCondition), count: rows.length }, { status: 200, headers: NO_CACHE });
  }

  const parts = (sp.get("bbox") ?? "").split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    return NextResponse.json({ cities: [] }, { status: 200, headers: NO_CACHE });
  }
  const limit = Math.min(Math.max(Number(sp.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const db = await getAppDb();
  const rows = await db.cityWeather.topByBbox(parts as [number, number, number, number], limit);
  const cities = rows.map(toCityCondition);
  return NextResponse.json({ cities, count: cities.length }, { status: 200, headers: NO_CACHE });
}

function toCityCondition(r: {
  cityId: string;
  name: string;
  cc?: string;
  lat: number;
  lng: number;
  population?: number;
  current?: unknown;
  daily?: unknown;
  updatedAt?: unknown;
}) {
  return {
    cityId: r.cityId,
    name: r.name,
    cc: r.cc,
    lat: r.lat,
    lng: r.lng,
    population: r.population,
    current: r.current,
    daily: r.daily,
    updatedAt: r.updatedAt,
  };
}
