import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/cables
 * Reads the worker-cached submarine cables + landing points from Mongo — the
 * public app NEVER calls TeleGeography directly. The data is near-static, so the
 * client fetches it once (and refetches on a worker `cables` socket push).
 * Configure the refresh cadence on the worker (CABLE_REFRESH_MS).
 */
export async function GET() {
  try {
    const db = await getAppDb();
    const { cables, landings } = await db.cables.list();
    return NextResponse.json(
      { cables, landings, count: cables.length },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), cables: [], landings: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
