import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_SATELLITE_GROUP, isValidGroup } from "../../../../lib/tracks/celestrak";
import { propagateAll } from "../../../../lib/tracks/propagate";
import type { TleRecord } from "../../../../lib/tracks/types";

/**
 * TLEs for a group — strictly the worker-ingested Mongo copy. The public app
 * never calls Celestrak itself: the worker owns that feed (tracks.ingestTles)
 * because Celestrak only serves each group once per ~2h and 403s repeat pulls
 * inside that window. A live fallback here would race the worker for that window,
 * burn it without persisting, and leave the DB permanently cold. If a group isn't
 * cached yet, we return empty and let the worker's next ingest warm it.
 */
async function tlesForGroup(group: string): Promise<TleRecord[]> {
  const db = await getAppDb();
  return db.satelliteTles.listByGroup(group);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/tracks/satellites?group=visual&limit=2000[&format=tle]
 * Default: propagated position snapshot (the admin list renders this).
 * `format=tle`: the raw parsed TLEs, so the map overlay can propagate them
 * client-side every tick for smooth motion.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const group = url.searchParams.get("group") || DEFAULT_SATELLITE_GROUP;
  const g = isValidGroup(group) ? group : DEFAULT_SATELLITE_GROUP;

  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100000) : 100000;

  try {
    const tles = await tlesForGroup(g);

    if (url.searchParams.get("format") === "tle") {
      return NextResponse.json(
        { group: g, count: tles.length, source: "db", tles: tles.slice(0, limit) },
        { status: 200, headers: NO_CACHE },
      );
    }

    const at = new Date();
    const satellites = propagateAll(tles, at).slice(0, limit);
    return NextResponse.json(
      { group: g, count: satellites.length, total: tles.length, source: "db", at: at.toISOString(), satellites },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { group: g, error: String(err), satellites: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
