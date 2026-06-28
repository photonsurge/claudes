import { NextResponse } from "next/server";
import { fetchAircraft } from "../../../../lib/tracks/opensky";
import { fetchAdsb } from "../../../../lib/tracks/adsb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/tracks/aircraft?bbox=w,s,e,n&limit=1500
 * Live ADS-B snapshot. Default provider is keyless adsb.lol (point+radius from
 * the bbox); set AIRCRAFT_PROVIDER=opensky to use OpenSky instead (wider bbox,
 * but needs OPENSKY_CLIENT_ID/SECRET).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  let bbox: [number, number, number, number] | undefined;
  const bboxRaw = url.searchParams.get("bbox");
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      bbox = parts as [number, number, number, number];
    }
  }

  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 10000) : 1500;

  try {
    const useOpenSky = process.env.AIRCRAFT_PROVIDER === "opensky";
    const all = useOpenSky ? await fetchAircraft(bbox) : await fetchAdsb(bbox);
    const aircraft = all.slice(0, limit);
    return NextResponse.json(
      { count: aircraft.length, total: all.length, at: new Date().toISOString(), aircraft },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), aircraft: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
