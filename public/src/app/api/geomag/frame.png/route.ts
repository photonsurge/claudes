import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/geomag/frame.png
 * Streams the worker-baked SCALAR total-intensity PNG from Mongo for the overlay's
 * WeatherLayers RasterLayer. The `.png` path matters — loaders.gl picks the decoder
 * by extension. Callers append `?v=<updatedAt>` so each bake gets a unique URL.
 */
async function GET__impl() {
  try {
    const db = await getAppDb();
    const frame = await db.geomag.latestPng();
    if (!frame) {
      return NextResponse.json(
        { error: "no geomag frame baked yet" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return new NextResponse(new Uint8Array(frame.data), {
      status: 200,
      headers: {
        "Content-Type": frame.contentType,
        "Cache-Control": "public, max-age=3600",
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
