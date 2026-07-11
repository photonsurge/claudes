import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { SummaryPeriod } from "@photonsurge/shared/db/event-summary-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const PERIODS: SummaryPeriod[] = ["hourly", "12h", "daily"];

/**
 * GET /api/roundup/latest — just the latest round-up for a cadence, for the
 * broadcast frame's world-spin deck slide. A public, single-doc cousin of
 * /api/admin/summaries (which also returns history for the admin screen).
 * Query: ?period=hourly|12h|daily.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("period") as SummaryPeriod | null;
  const period: SummaryPeriod = raw && PERIODS.includes(raw) ? raw : "hourly";

  const db = await getAppDb();
  const latest = await db.eventSummaries.latest(period);

  return NextResponse.json({ period, latest }, { status: 200, headers: NO_CACHE });
}
