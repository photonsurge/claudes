import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import {
  buildAreaForecastDays,
  DEFAULT_FORECAST_DAYS,
  forecastHorizonHours,
} from "../../../../../lib/weather-forecast";
import { workerForecastArea } from "../../../../../lib/worker-sample";
import { withCache } from "../../../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Variables the daily card strip + hazard rules need; fetched by default. */
const DEFAULT_VARIABLES = ["temp", "wind", "gust", "rain", "cloud", "storm"];

/** Server-side Redis hold — see /forecast/point. */
const FCST_TTL_SEC = Number(process.env.WEATHER_PANEL_CACHE_TTL_SEC || 300);

/**
 * GET /api/weather/forecast/area?west=&south=&east=&north=[&variables=][&model=]
 *
 * Spatial daily hi/lo cards over an area (today + next 3 days): per day, the
 * covered pixels aggregate to mean/min/max, with hazards evaluated off the
 * area's daily max ("worst case in the shot"). A west > east window wraps
 * the antimeridian.
 */
async function GET__impl(req: Request) {
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

  const key = `feed:v1:wfcst:area:${west},${south},${east},${north}:${model ?? "-"}:${variables.join(",")}`;
  const bbox: [number, number, number, number] = [west, south, east, north];
  // Public no longer decodes — the worker samples the forecast store's area stats.
  const { value, hit } = await withCache(key, FCST_TTL_SEC, async () => {
    const series = await workerForecastArea({
      bbox,
      variables,
      model,
      maxHours: forecastHorizonHours(DEFAULT_FORECAST_DAYS),
    });
    return buildAreaForecastDays(series, bbox);
  });

  return NextResponse.json(value, {
    headers: { "Cache-Control": "public, max-age=60", "X-Cache": hit ? "hit" : "miss" },
  });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
