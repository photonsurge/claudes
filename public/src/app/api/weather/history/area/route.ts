import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildAreaHistorySeries, parseTimeParam } from "../../../../../lib/weather-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/weather/history/area?west=&south=&east=&north=&variable=temp[&from=][&to=][&model=]
 *
 * Spatial statistics of the frame archive over an area: per valid time the
 * covered pixels aggregate to mean/min/max, plus temporal stats over the area
 * means and the spatial extremes across the whole window ("hottest reading
 * anywhere in the shot this week"). A west > east window wraps the
 * antimeridian. Time params behave like /point.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const west = Number(url.searchParams.get("west"));
  const south = Number(url.searchParams.get("south"));
  const east = Number(url.searchParams.get("east"));
  const north = Number(url.searchParams.get("north"));
  const variable = url.searchParams.get("variable") ?? "";
  if (![west, south, east, north].every(Number.isFinite) || !variable || south >= north) {
    return NextResponse.json(
      { error: "west, south, east, north (south < north) and variable are required" },
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

  const payload = await buildAreaHistorySeries(variable, frames, [west, south, east, north]);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
