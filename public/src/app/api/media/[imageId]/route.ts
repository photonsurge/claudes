import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/media/[imageId] — stream an admin-uploaded image's bytes from Mongo
 * with its stored content-type. Public (not admin-gated) so the same images can
 * render on the broadcast/watch output, not just in admin; the bytes aren't
 * sensitive. Callers append `?v=<updatedAt>` so a replaced image gets a fresh
 * URL, hence the long immutable cache. 404 until the image exists / has bytes.
 */
async function GET__impl(
  _req: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const { imageId } = await params;
  try {
    const db = await getAppDb();
    const media = await db.adminImages.getBytes(decodeURIComponent(imageId));
    if (!media) {
      return NextResponse.json(
        { error: "image not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const body = new Uint8Array(media.data);
    if (body.byteLength === 0) {
      return NextResponse.json(
        { error: "empty image" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": media.contentType,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
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
