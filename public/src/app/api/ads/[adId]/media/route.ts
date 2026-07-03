import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ads/[adId]/media — stream one ad's stored media bytes (image or
 * video) from Mongo, with the stored content-type. Callers append `?v=<updatedAt>`
 * (from the ad metadata) so a replaced creative gets a fresh URL — hence the
 * long, immutable cache. 404 until the ad exists / has bytes.
 *
 * When large-video/GridFS storage lands, this route grows a `storage === "gridfs"`
 * branch that streams from the bucket with range support; the URL shape is unchanged.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ adId: string }> },
) {
  const { adId } = await params;
  try {
    const db = await getAppDb();
    const media = await db.ads.getMedia(decodeURIComponent(adId));
    if (!media) {
      return NextResponse.json(
        { error: "ad media not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Uint8Array view keeps Next/Web happy as a BodyInit.
    const body = new Uint8Array(media.data);
    // Never serve an empty body with an immutable cache header (poisons the cache).
    if (body.byteLength === 0) {
      return NextResponse.json(
        { error: "empty ad media" },
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
