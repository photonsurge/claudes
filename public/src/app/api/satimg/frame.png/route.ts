import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/satimg/frame.png?sat=<id>
 * Streams one bird's worker-baked, reprojected RGBA PNG from Mongo for the overlay's
 * BitmapLayer. `sat` selects the bird (default "himawari9"). Callers append
 * `&v=<updatedAt>` (from /api/satimg) so each baked frame gets a unique URL — hence
 * the long cache. 404 until the worker has baked that bird's first frame.
 */
async function GET__impl(req: Request) {
  try {
    const sat = new URL(req.url).searchParams.get("sat") || "himawari9";
    const db = await getAppDb();
    const frame = await db.satimg.latestPng(sat);
    if (!frame) {
      return NextResponse.json(
        { error: `no satimg frame baked yet for ${sat}` },
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
