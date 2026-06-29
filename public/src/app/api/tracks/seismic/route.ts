import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { Quake } from "../../../../lib/tracks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/tracks/seismic?bbox=w,s,e,n&minMag=2.5&limit=2000
 * Reads the worker-cached USGS earthquakes from Mongo — the public app NEVER
 * calls USGS directly. Events are point-in-time (not dead-reckoned), so the
 * client just polls this on a slow interval. Configure the feed/cadence on the
 * worker (USGS_FEED, SEISMIC_SNAPSHOT_MS).
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

  const minMagRaw = Number(url.searchParams.get("minMag"));
  const minMag = Number.isFinite(minMagRaw) ? minMagRaw : undefined;

  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  try {
    const db = await getAppDb();
    const rows = await db.quakes.list({ minMag, bbox, limit });
    const quakes: Quake[] = rows.map((r) => ({
      id: r.quakeId,
      mag: r.mag,
      place: r.place,
      time: new Date(r.time).getTime(),
      lng: r.lng,
      lat: r.lat,
      depthKm: r.depthKm,
      url: r.url,
      tsunami: r.tsunami || undefined,
    }));
    return NextResponse.json(
      { count: quakes.length, quakes },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), quakes: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
