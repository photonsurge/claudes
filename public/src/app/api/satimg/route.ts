import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/satimg
 * Reads the worker-cached satellite-imagery frame METADATA (Himawari-9 …) from
 * Mongo — the public app NEVER calls the raw S3 feed. Returns `{ frames }`, one
 * entry per baked bird (bounds/timestamps/composite, no pixel bytes); each bird's
 * reprojected PNG is served at /api/satimg/frame.png?sat=<id>. Bake cadence lives
 * on the worker (SATIMG_REFRESH_MS, ~10 min).
 */
async function GET__impl() {
  try {
    const db = await getAppDb();
    const { frames } = await db.satimg.all();
    return NextResponse.json({ frames }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), frames: [] },
      { status: 502, headers: NO_CACHE },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
