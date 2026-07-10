import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { Aircraft } from "../../../../lib/tracks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** A frame older than this is flagged stale (worker isn't snapshotting). */
const STALE_MS = 5 * 60 * 1000;

/**
 * GET /api/tracks/aircraft?bbox=w,s,e,n&limit=1500&ids=abc,def
 * Reads the newest aircraft frame the worker cached in Mongo — the public app
 * NEVER calls upstream feeds directly. The response carries each track's
 * heading + speed and the frame time (`at`) so the client can dead-reckon
 * positions forward between frames. Configure regions/cadence on the worker
 * (SNAPSHOT_REGIONS, AIRCRAFT_SNAPSHOT_MS).
 *
 * `ids` scopes to a specific set of ICAO24s (the overlay sends notable + on-air
 * craft when zoomed out); a present-but-empty `ids` returns an empty frame.
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

  const idsRaw = url.searchParams.get("ids");
  const ids =
    idsRaw != null ? idsRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : undefined;

  // Optional cap; default uncapped (local broadcast tool — show everything).
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  // Scoped to an empty set → nothing to show; skip the query.
  if (ids && ids.length === 0) {
    return NextResponse.json(
      { count: 0, total: 0, at: null, stale: false, aircraft: [] },
      { status: 200, headers: NO_CACHE },
    );
  }

  try {
    const db = await getAppDb();
    const { at, rows } = await db.trackSnapshots.latest({ kind: "aircraft", bbox, ids, limit });

    // Join the cached hexdb metadata (registration/type/operator) by ICAO24.
    const icaos = [...new Set(rows.map((r) => r.externalId.toLowerCase()))];
    const metaRes = icaos.length
      ? await db.aircraftMeta.getAll({ id: { $in: icaos } }, { limit: icaos.length, sort: null })
      : { data: [] };
    const metaById = new Map((metaRes.data ?? []).map((m) => [m.id, m]));

    const aircraft: Aircraft[] = rows.map((r) => {
      const m = metaById.get(r.externalId.toLowerCase());
      return {
        icao24: r.externalId,
        callsign: r.name,
        country: r.country,
        lng: r.lng,
        lat: r.lat,
        altM: r.altM,
        velocityMS: r.speed,
        headingDeg: r.headingDeg,
        verticalRateMS: r.verticalRateMS,
        onGround: r.altM === 0,
        registration: m?.registration,
        acType: m?.type,
        operator: m?.operator,
      };
    });
    const stale = !at || Date.now() - at.getTime() > STALE_MS;
    return NextResponse.json(
      { count: aircraft.length, total: aircraft.length, at: at?.toISOString() ?? null, stale, aircraft },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), aircraft: [], count: 0, stale: true },
      { status: 502, headers: NO_CACHE },
    );
  }
}
