import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/events[?status=ACTIVE] — the unified WatchedEvent list (newest
 * first), backing the /admin/events page. Optional `status` filter.
 */
async function GET__impl(req: Request) {
  const db = await getAppDb();
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  const events = await db.watchedEvents.list({ status, limit: 300 });
  return NextResponse.json({ events }, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
