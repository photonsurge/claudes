import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { workerAreaHistory } from "../../../../../lib/worker-sample";
import { withCache } from "../../../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-side Redis hold — see /history/point. */
const HIST_TTL_SEC = Number(process.env.WEATHER_PANEL_CACHE_TTL_SEC || 300);

/**
 * GET /api/weather/history/area?west=&south=&east=&north=&variable=temp[&from=][&to=][&model=]
 *
 * Spatial statistics of the frame archive over an area: per valid time the
 * covered pixels aggregate to mean/min/max, plus temporal stats over the area
 * means and the spatial extremes across the whole window ("hottest reading
 * anywhere in the shot this week"). A west > east window wraps the
 * antimeridian. Time params behave like /point.
 */
async function GET__impl(req: Request) {
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

  const model = url.searchParams.get("model");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const key = `feed:v1:whist:area:${west},${south},${east},${north}:${variable}:${model ?? "-"}:${from ?? "-"}:${to ?? "-"}`;
  // Public no longer decodes — the worker samples the archive and returns numbers.
  const { value, hit } = await withCache(key, HIST_TTL_SEC, () =>
    workerAreaHistory({
      variable,
      bbox: [west, south, east, north],
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
