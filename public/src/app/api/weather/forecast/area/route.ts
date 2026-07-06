import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildAreaForecastDays } from "../../../../../lib/weather-forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Variables the daily card strip + hazard rules need; fetched by default. */
const DEFAULT_VARIABLES = ["temp", "wind", "gust", "rain", "cloud", "storm"];

/**
 * GET /api/weather/forecast/area?west=&south=&east=&north=[&variables=][&model=]
 *
 * Spatial daily hi/lo cards over an area (today + next 3 days): per day, the
 * covered pixels aggregate to mean/min/max, with hazards evaluated off the
 * area's daily max ("worst case in the shot"). A west > east window wraps
 * the antimeridian.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const west = Number(url.searchParams.get("west"));
  const south = Number(url.searchParams.get("south"));
  const east = Number(url.searchParams.get("east"));
  const north = Number(url.searchParams.get("north"));
  if (![west, south, east, north].every(Number.isFinite) || south >= north) {
    return NextResponse.json(
      { error: "west, south, east, north (south < north) are required" },
      { status: 400 },
    );
  }
  const requested = url.searchParams.get("variables")?.split(",").map((v) => v.trim()).filter(Boolean);
  const variables = requested && requested.length ? requested : DEFAULT_VARIABLES;
  const model = url.searchParams.get("model") ?? undefined;

  const db = await getAppDb();
  const framesByVariable: Record<string, any[]> = {};
  await Promise.all(
    variables.map(async (variable) => {
      framesByVariable[variable] = await db.weatherForecastFrames.getSeries({ variable, model });
    }),
  );

  const payload = await buildAreaForecastDays(framesByVariable, [west, south, east, north]);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
