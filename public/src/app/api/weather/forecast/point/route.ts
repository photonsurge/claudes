import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildForecastDays, buildForecastSteps } from "../../../../../lib/weather-forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Variables the daily card strip + hazard rules need; fetched by default. */
const DEFAULT_VARIABLES = ["temp", "wind", "gust", "rain", "cloud", "storm"];

/**
 * GET /api/weather/forecast/point?lat=&lng=[&variables=temp,wind,...][&model=][&shape=days|steps][&days=N]
 *
 * Sample the rolling forecast store at a point. `shape=days` (default) returns
 * one daily hi/lo card per day — `days` sets how many (default 4 detailed days,
 * up to 16 for the 12-hourly outlook). `shape=steps` returns the full 3-hourly
 * timeline (today..+72h). Both carry derived condition + hazard flags.
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
  const shape = url.searchParams.get("shape") === "steps" ? "steps" : "days";
  const days = Math.min(16, Math.max(1, Math.floor(Number(url.searchParams.get("days"))) || 4));

  const db = await getAppDb();
  const framesByVariable: Record<string, any[]> = {};
  await Promise.all(
    variables.map(async (variable) => {
      framesByVariable[variable] = await db.weatherForecastFrames.getSeries({ variable, model });
    }),
  );

  const payload =
    shape === "steps"
      ? await buildForecastSteps(framesByVariable, lat, lng)
      : await buildForecastDays(framesByVariable, lat, lng, days);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
