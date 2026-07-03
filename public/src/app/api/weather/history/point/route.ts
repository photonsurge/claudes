import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildHistorySeries, parseTimeParam } from "../../../../../lib/weather-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const db = await getAppDb();
  const frames = await db.weatherFrames.getSeries({
    variable,
    model: url.searchParams.get("model") ?? undefined,
    from: parseTimeParam(url.searchParams.get("from")),
    to: parseTimeParam(url.searchParams.get("to")),
  });

  const payload = await buildHistorySeries(variable, frames, lat, lng);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
