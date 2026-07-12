import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/aurora/frame.png
 * Streams the worker-baked SCALAR aurora probability PNG from Mongo for the
 * overlay's WeatherLayers RasterLayer. The `.png` path matters — loaders.gl picks
 * the PNG decoder by extension. Callers append `?v=<updatedAt>` (from /api/aurora)
 * so each baked frame gets a unique URL — hence the long cache. 404 until the
 * worker has baked the first frame.
 */
async function GET__impl() {
  try {
    const db = await getAppDb();
    const frame = await db.aurora.latestPng();
    if (!frame) {
      return NextResponse.json(
        { error: "no aurora frame baked yet" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return new NextResponse(new Uint8Array(frame.data), {
      status: 200,
      headers: {
        "Content-Type": frame.contentType,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
