import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import {
  buildForecastDays,
  buildForecastSteps,
  forecastHorizonHours,
} from "../../../../../lib/weather-forecast";
import { workerForecastPoint } from "../../../../../lib/worker-sample";
import { withCache } from "../../../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Variables the daily card strip + hazard rules need; fetched by default. */
const DEFAULT_VARIABLES = ["temp", "wind", "gust", "rain", "cloud", "storm"];

/** Server-side Redis hold — the forecast store only changes on a new run. */
const FCST_TTL_SEC = Number(process.env.WEATHER_PANEL_CACHE_TTL_SEC || 300);

/**
 * GET /api/weather/forecast/point?lat=&lng=[&variables=temp,wind,...][&model=][&shape=days|steps][&days=N]
 *
 * Sample the rolling forecast store at a point. `shape=days` (default) returns
 * one daily hi/lo card per day — `days` sets how many (default 4 detailed days,
 * up to 16 for the 12-hourly outlook). `shape=steps` returns the full 3-hourly
 * timeline (today..+72h). Both carry derived condition + hazard flags.
 */
async function GET__impl(req: Request) {
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

  const key = `feed:v1:wfcst:pt:${lat}:${lng}:${shape}:${days}:${model ?? "-"}:${variables.join(",")}`;
  // Public no longer decodes — the worker samples the forecast store; we only
  // compose the day cards / timeline from the returned numbers.
  const { value, hit } = await withCache(key, FCST_TTL_SEC, async () => {
    if (shape === "steps") {
      const series = await workerForecastPoint({ lat, lng, variables, model, maxHours: 72 });
      return buildForecastSteps(series, lat, lng);
    }
    const series = await workerForecastPoint({
      lat,
      lng,
      variables,
      model,
      maxHours: forecastHorizonHours(days),
    });
    return buildForecastDays(series, lat, lng, days);
  });

  return NextResponse.json(value, {
    headers: { "Cache-Control": "public, max-age=60", "X-Cache": hit ? "hit" : "miss" },
  });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
