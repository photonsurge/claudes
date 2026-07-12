import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { SummaryPeriod } from "@photonsurge/shared/db/event-summary-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const PERIODS: SummaryPeriod[] = ["hourly", "12h", "daily"];

/**
 * GET /api/admin/summaries — the latest round-up for a cadence plus recent
 * history, for the admin screen. Query: ?period=hourly|12h|daily, ?history=10.
 */
async function GET__impl(req: Request) {
  const q = new URL(req.url).searchParams;
  const raw = q.get("period") as SummaryPeriod | null;
  const period: SummaryPeriod = raw && PERIODS.includes(raw) ? raw : "hourly";
  const historyN = Math.max(1, Math.min(50, Number(q.get("history") || 10)));

  const db = await getAppDb();
  const [latest, history] = await Promise.all([
    db.eventSummaries.latest(period),
    db.eventSummaries.list({ period, limit: historyN }),
  ]);

  return NextResponse.json({ period, latest, history }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
