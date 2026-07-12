import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/weather/tex/[id] — stream a baked texture's bytes, cached forever. */
async function GET__impl(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  // URLs carry a .png/.tif suffix so the client image loader can select a
  // decoder by extension; the stored id has none.
  const id = rawId.replace(/\.(png|tiff?|webp)$/i, "");
  const db = await getAppDb();
  // Reads the shared ${BLOB_DIR} folder first (Mongo I/O off the hot path), with
  // the inline doc bytes as the pre-migration fallback. Normalisation lives in
  // the store (toBuffer), so the route just needs the bytes.
  const tex = await db.weatherTextures.getBytes(id);
  if (!tex) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Uint8Array view keeps Next/Web happy as a BodyInit.
  const body = new Uint8Array(tex.data);

  // Never serve an empty body with an immutable cache header — that poisons the
  // browser cache (an undecodable image cached for a year). Fail loud + no-store.
  if (body.byteLength === 0) {
    return NextResponse.json(
      { error: "empty texture" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": tex.contentType || "image/png",
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
