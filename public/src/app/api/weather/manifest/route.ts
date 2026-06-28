import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildManifestFromRun } from "../../../../lib/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

/**
 * GET /api/weather/manifest — the latest published run as a client manifest
 * (texture ids rewritten to URLs). Returns `{run:null}` when nothing published.
 */
export async function GET() {
  const db = await getAppDb();
  const run = await db.latestPublishedRun();
  if (!run) {
    return NextResponse.json({ run: null }, { status: 200, headers: NO_CACHE });
  }
  const manifest = buildManifestFromRun(run);
  return NextResponse.json(manifest, { status: 200, headers: NO_CACHE });
}
