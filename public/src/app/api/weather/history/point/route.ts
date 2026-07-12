import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildHistorySeries, parseTimeParam } from "../../../../../lib/weather-history";
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
export async function GET(req: Request) {
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
  // fail-open (a Redis outage just recomputes). Repeat director/panel polls skip
  // the sharp decode entirely.
  const key = `feed:v1:whist:pt:${lat}:${lng}:${variable}:${model ?? "-"}:${from ?? "-"}:${to ?? "-"}`;
  const { value, hit } = await withCache(key, HIST_TTL_SEC, async () => {
    const db = await getAppDb();
    // listMeta (no bytes) + a by-id loader: the builder streams only the picked
    // frames' bytes a few at a time instead of buffering the whole series.
    const meta = await db.weatherFrames.listMeta({
      variable,
      model: model ?? undefined,
      from: parseTimeParam(from),
      to: parseTimeParam(to),
    });
    return buildHistorySeries(variable, meta, lat, lng, (id) => db.weatherFrames.getByID(id));
  });

  return NextResponse.json(value, {
    headers: { "Cache-Control": "public, max-age=60", "X-Cache": hit ? "hit" : "miss" },
  });
}
