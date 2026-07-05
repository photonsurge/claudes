import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** Default search radius — seismometers are sparser than tide gauges, so this is wider. */
const DEFAULT_MAX_KM = 1500;
/** How many nearby live stations to return — the panel cycles through this set. */
const DEFAULT_LIMIT = 6;

/**
 * GET /api/tracks/seismo?lat=..&lng=..&maxKm=1500&limit=6
 * Returns the worker-cached live seismograph series for the stations NEAREST
 * the given point (plural — the broadcast panel cycles through them and the
 * globe overlay highlights whichever is active), or `{ stations: [] }` when
 * none are in range. The public app never talks to SeedLink directly; the
 * worker streams only the stations near what's on air (see worker's
 * seismo/loop.ts).
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
    const near = await db.seismoSeries.nearMany({ lng, lat, maxKm, limit });
    return NextResponse.json(
      {
        stations: near.map(({ series, distanceKm }) => ({
          net: series.net,
          sta: series.sta,
          loc: series.loc,
          cha: series.cha,
          siteName: series.siteName,
          lat: series.lat,
          lng: series.lng,
          distanceKm,
          sampleRateHz: series.sampleRateHz,
          samples: series.samples,
          latest: series.latest,
          updatedAt: series.updatedAt,
        })),
      },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err), stations: [] }, { status: 502, headers: NO_CACHE });
  }
}
