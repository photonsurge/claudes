import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { composeManifest } from "../../../../lib/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

/**
 * GET /api/weather/manifest — the multi-supplier portfolio composed into ONE
 * client manifest: the latest published run of each model (gfs/ifs/rtofs/
 * gfswave-mosaic), with each variable served by its highest-priority source.
 * Returns `{run:null}` when nothing is published.
 */
export async function GET() {
  const db = await getAppDb();
  const runs = await db.latestPublishedRunsByModel();
  const manifest = composeManifest(runs);
  if (!manifest) {
    return NextResponse.json({ run: null }, { status: 200, headers: NO_CACHE });
  }
  return NextResponse.json(manifest, { status: 200, headers: NO_CACHE });
}
