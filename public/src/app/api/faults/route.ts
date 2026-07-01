import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/faults
 * Reads the worker-cached tectonic plate boundaries (Bird 2003) from Mongo — the
 * public app NEVER calls the source directly. The data is effectively fixed, so
 * the client fetches it once (and refetches on a worker `faults` socket push).
 * Configure the refresh cadence on the worker (FAULT_REFRESH_MS).
 */
export async function GET() {
  try {
    const db = await getAppDb();
    const { faults } = await db.faults.list();
    return NextResponse.json(
      { faults, count: faults.length },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), faults: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
