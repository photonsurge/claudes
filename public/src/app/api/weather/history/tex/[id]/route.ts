import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { bufferOf } from "@photonsurge/shared/utill/buffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/weather/history/tex/[id] — stream one archived frame's PNG bytes,
 * cached forever (frames are immutable once written). Mirrors
 * /api/weather/tex but reads the WeatherFrame archive instead of the
 * retention-pruned run textures.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = rawId.replace(/\.(png|tiff?|webp)$/i, "");
  const db = await getAppDb();
  const frame = await db.weatherFrames.getByID(id);
  if (!frame) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = new Uint8Array(bufferOf(frame.data));
  // Never pair an empty body with an immutable cache header (poisoned cache).
  if (body.byteLength === 0) {
    return NextResponse.json(
      { error: "empty frame" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": frame.contentType || "image/png",
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
