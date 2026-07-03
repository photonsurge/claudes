import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/geomag
 * Reads the worker-cached geomagnetic-field frame METADATA (IGRF total intensity)
 * from Mongo. Returns `{ geomag }` with epoch/year/range/bounds (no pixel bytes);
 * the scalar texture itself is served at /api/geomag/frame.png.
 */
export async function GET() {
  try {
    const db = await getAppDb();
    const { geomag } = await db.geomag.latest();
    return NextResponse.json({ geomag }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), geomag: null },
      { status: 502, headers: NO_CACHE },
    );
  }
}
