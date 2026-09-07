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
  // Fallback = RELATIVE redirect to the deploy-time static file, resolved by
  // the CLIENT against the URL it actually requested. Never build an absolute
  // URL from req.url here: inside the container that origin is the 0.0.0.0
  // bind address (the compose HOSTNAME fix), and a browser source handed
  // `Location: https://0.0.0.0:10100/data/night.jpg` dies with "Failed to
  // fetch" — a permanently black basemap on the OBS encoders. no-store so a
  // later successful bake is picked up on the next reload.
  const fallback = () =>
    new NextResponse(null, {
      status: 302,
      headers: { Location: tex.fallback, "Cache-Control": "no-store" },
    });

  try {
    const db = await getAppDb();
    const bytes = await db.basemapTextures.get(id);
    if (!bytes) {
      // No baked blob yet — fall back to the static deploy-time file.
      return fallback();
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
    return fallback();
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
