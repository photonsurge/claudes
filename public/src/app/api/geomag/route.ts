import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { withCache, FEED_TTL_SEC } from "../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/geomag
 * Reads the worker-cached geomagnetic-field frame METADATA (IGRF total intensity)
 * from Mongo. Returns `{ geomag }` with epoch/year/range/bounds (no pixel bytes);
 * the scalar texture itself is served at /api/geomag/frame.png.
 */
async function GET__impl() {
  try {
    const { value, hit } = await withCache("feed:v1:geomag", FEED_TTL_SEC, async () => {
      const db = await getAppDb();
      const { geomag } = await db.geomag.latest();
      return { geomag };
    });
    return NextResponse.json(value, {
      status: 200,
      headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), geomag: null },
      { status: 502, headers: NO_CACHE },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
