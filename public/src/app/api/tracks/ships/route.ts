import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { Ship } from "../../../../lib/tracks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** A frame older than this is flagged stale (worker isn't snapshotting). */
const STALE_MS = 10 * 60 * 1000;

/**
 * GET /api/tracks/ships?bbox=w,s,e,n
 * Reads the newest AIS frame the worker cached in Mongo — the public app NEVER
 * opens its own aisstream connection. Each ship carries heading + speed and the
 * frame time (`at`) so the client can dead-reckon between frames. Configure the
 * worker (AISSTREAM_API_KEY, SNAPSHOT_REGIONS, SHIP_SNAPSHOT_MS).
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

  try {
    const db = await getAppDb();
    const { at, rows } = await db.trackSnapshots.latest({ kind: "ship", bbox });
    const ships: Ship[] = rows.map((r) => ({
      mmsi: r.externalId,
      name: r.name,
      lng: r.lng,
      lat: r.lat,
      sogKn: r.speed,
      cogDeg: r.cogDeg,
      headingDeg: r.headingDeg,
    }));
    const stale = !at || Date.now() - at.getTime() > STALE_MS;
    return NextResponse.json(
      { configured: true, count: ships.length, at: at?.toISOString() ?? null, stale, ships },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: String(err), ships: [], count: 0, stale: true },
      { status: 502, headers: NO_CACHE },
    );
  }
}
