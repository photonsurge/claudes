import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/cams
 * Reads the worker-cached webcam catalog (active cams) from Mongo — the public
 * app never calls the upstream provider directly. Used by the broadcast overlay
 * to show webcams near an on-air event. No limit (show all); the client filters
 * to the ones near the event. Refresh cadence lives on the worker.
 */
export async function GET() {
  try {
    const db = await getAppDb();
    const cams = await db.cams.list({ status: "active" });
    return NextResponse.json({ cams, count: cams.length }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), cams: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
