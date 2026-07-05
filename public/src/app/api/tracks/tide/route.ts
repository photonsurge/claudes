import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** Default search radius — beyond this a point is "not coastal", gauge hides. */
const DEFAULT_MAX_KM = 400;
/** How many nearby gauges to return — the panel cycles through this set. */
const DEFAULT_LIMIT = 4;

/**
 * GET /api/tracks/tide?lat=..&lng=..&maxKm=400&limit=4
 * Returns the worker-cached sea-level series for the gauges NEAREST the given
 * point (plural — the broadcast panel cycles through them, like the seismic
 * feed), or `{ stations: [] }` when none are in range (the broadcast gauge
 * then hides — "not relevant"). The public app never calls IOC directly; the
 * worker caches only the gauges near what's on air (see worker jobs/tides.ts).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const maxKmRaw = Number(url.searchParams.get("maxKm"));
  const maxKm = Number.isFinite(maxKmRaw) && maxKmRaw > 0 ? maxKmRaw : DEFAULT_MAX_KM;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng required", stations: [] }, { status: 400, headers: NO_CACHE });
  }

  try {
    const db = await getAppDb();
    const near = await db.tideSeries.nearMany({ lng, lat, maxKm, limit });
    return NextResponse.json(
      {
        stations: near.map(({ series, distanceKm }) => ({
          stationId: series.stationId,
          provider: series.provider,
          name: series.name,
          lat: series.lat,
          lng: series.lng,
          distanceKm,
          unit: series.unit,
          latest: series.latest,
          samples: series.samples,
          updatedAt: series.updatedAt,
        })),
      },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err), stations: [] }, { status: 502, headers: NO_CACHE });
  }
}
