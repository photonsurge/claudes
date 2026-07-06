import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildForecastDays } from "../../../../../lib/weather-forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Variables the daily card strip + hazard rules need; fetched by default. */
const DEFAULT_VARIABLES = ["temp", "wind", "gust", "rain", "cloud", "storm"];

/**
 * GET /api/weather/forecast/point?lat=&lng=[&variables=temp,wind,...][&model=]
 *
 * Sample the rolling forecast store (today + next 3 days) at a point and
 * return one daily hi/lo card per day, plus any derived hazard flags.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
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

  const payload = await buildForecastDays(framesByVariable, lat, lng);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
