import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import {
  DEFAULT_SATELLITE_GROUP,
  fetchGroupTle,
  isValidGroup,
} from "../../../../lib/tracks/celestrak";
import { parseTle } from "../../../../lib/tracks/tle";
import { propagateAll } from "../../../../lib/tracks/propagate";
import type { TleRecord } from "../../../../lib/tracks/types";

/** TLEs for a group: prefer the worker-ingested Mongo copy, fall back to Celestrak. */
async function tlesForGroup(group: string): Promise<{ tles: TleRecord[]; source: "db" | "celestrak" }> {
  try {
    const db = await getAppDb();
    const stored = await db.satelliteTles.listByGroup(group);
    if (stored.length) return { tles: stored, source: "db" };
  } catch {
    /* DB unavailable — fall through to live fetch */
  }
  return { tles: parseTle(await fetchGroupTle(group)), source: "celestrak" };
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
    const { tles, source } = await tlesForGroup(g);

    if (url.searchParams.get("format") === "tle") {
      return NextResponse.json(
        { group: g, count: tles.length, source, tles: tles.slice(0, limit) },
        { status: 200, headers: NO_CACHE },
      );
    }

    const at = new Date();
    const satellites = propagateAll(tles, at).slice(0, limit);
    return NextResponse.json(
      { group: g, count: satellites.length, total: tles.length, source, at: at.toISOString(), satellites },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { group: g, error: String(err), satellites: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
