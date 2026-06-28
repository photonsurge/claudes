import { NextResponse } from "next/server";
import {
  DEFAULT_SATELLITE_GROUP,
  fetchGroupTle,
  isValidGroup,
} from "../../../../lib/tracks/celestrak";
import { parseTle } from "../../../../lib/tracks/tle";
import { propagateAll } from "../../../../lib/tracks/propagate";

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
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 10000) : 5000;

  try {
    const tles = parseTle(await fetchGroupTle(g));

    if (url.searchParams.get("format") === "tle") {
      return NextResponse.json(
        { group: g, count: tles.length, tles: tles.slice(0, limit) },
        { status: 200, headers: NO_CACHE },
      );
    }

    const at = new Date();
    const satellites = propagateAll(tles, at).slice(0, limit);
    return NextResponse.json(
      { group: g, count: satellites.length, total: tles.length, at: at.toISOString(), satellites },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { group: g, error: String(err), satellites: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
