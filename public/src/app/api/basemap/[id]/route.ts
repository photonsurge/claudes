import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { getBasemapTexture } from "@photonsurge/shared/basemaps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/basemap/<id>[.jpg]  (id ∈ satellite | terrain | night)
 * Serves the full-globe basemap base image the raster basemaps drape on the sphere.
 * Bytes come from the shared ${BLOB_DIR} store (written by the worker `basemap.refresh`
 * job), so a corrupt/stale texture is fixable from /admin/jobs without a redeploy.
 * Until the first bake — or for an unknown id — it redirects to the deploy-time
 * static file in /data (fetch-assets.sh), so the globe never breaks. Short cache so
 * a re-bake shows up on the next reload.
 */
async function GET__impl(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = raw.replace(/\.jpg$/i, "");
  const tex = getBasemapTexture(id);
  // Unknown id → 404 (don't open an arbitrary redirect target).
  if (!tex) {
    return NextResponse.json(
      { error: `unknown basemap texture ${id}` },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const db = await getAppDb();
    const bytes = await db.basemapTextures.get(id);
    if (!bytes) {
      // No baked blob yet — fall back to the static deploy-time file.
      return NextResponse.redirect(new URL(tex.fallback, req.url), 302);
    }
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": tex.contentType,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    // On any store error, still render a globe: redirect to the static file.
    return NextResponse.redirect(new URL(tex.fallback, req.url), 302);
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
