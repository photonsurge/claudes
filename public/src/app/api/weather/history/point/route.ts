import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { workerPointHistory } from "../../../../../lib/worker-sample";
import { withCache } from "../../../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-side Redis hold for a composed series. Short by design — the frame
 *  archive only grows on worker ingest (hours apart), so this collapses the
 *  director's repeat previews + every OBS source onto one decode. */
const HIST_TTL_SEC = Number(process.env.WEATHER_PANEL_CACHE_TTL_SEC || 300);

/**
 * GET /api/weather/history/point?lat=&lng=&variable=temp[&from=][&to=][&model=]
 *
 * Sample the long-term frame archive at a point and return the time series
 * plus stats (min/max/avg — "average temperature at this lat/lng"). `from`/`to`
 * accept ISO strings or epoch ms and default to the whole archive. Scalars
 * return `value` per point; uv variables (wind) return `u`/`v`/`speed`.
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const variable = url.searchParams.get("variable") ?? "";
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !variable) {
    return NextResponse.json(
      { error: "lat, lng and variable are required" },
      { status: 400 },
    );
  }

  const model = url.searchParams.get("model");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  // Redis result-cache keyed by the full param set that determines the payload;
  // fail-open (a Redis outage just re-asks the worker). Public no longer decodes —
  // the worker samples the archive (sole frame decoder) and returns the numbers.
  const key = `feed:v1:whist:pt:${lat}:${lng}:${variable}:${model ?? "-"}:${from ?? "-"}:${to ?? "-"}`;
  const { value, hit } = await withCache(key, HIST_TTL_SEC, () =>
    workerPointHistory({
      variable,
      lat,
      lng,
      from: from ?? undefined,
      to: to ?? undefined,
      model: model ?? undefined,
    }),
  );

  return NextResponse.json(value, {
    headers: { "Cache-Control": "public, max-age=60", "X-Cache": hit ? "hit" : "miss" },
  });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
