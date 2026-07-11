import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { withCache, FEED_TTL_SEC } from "../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/aurora
 * Reads the worker-cached aurora frame METADATA (NOAA SWPC OVATION) from Mongo —
 * the public app NEVER calls SWPC directly. Returns `{ aurora }` with the frame's
 * bounds/timestamps/peak probability (no pixel bytes); the glow PNG itself is
 * served at /api/aurora/image. Configure the bake cadence on the worker
 * (AURORA_REFRESH_MS, ~5 min).
 */
export async function GET() {
  try {
    const { value, hit } = await withCache("feed:v1:aurora", FEED_TTL_SEC, async () => {
      const db = await getAppDb();
      const { aurora } = await db.aurora.latest();
      return { aurora };
    });
    return NextResponse.json(value, {
      status: 200,
      headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), aurora: null },
      { status: 502, headers: NO_CACHE },
    );
  }
}
