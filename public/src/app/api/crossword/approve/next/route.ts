import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { QUEUE_LIMIT_MAX } from "@photonsurge/shared/crossword-bank";
import { requireAdmin } from "../../../../../lib/require-admin";
import { parseQueueQuery, type ApproveNextResponse } from "../../../../../components/admin/crosswords/approve/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/crossword/approve/next — the next words for the approval queue
 * (§7.4), most common first, with their clues (after `cleanClue`) and any
 * stored suggestion, plus the approved-pool counter. Query: `band`, `min` and
 * `max` (length), `letter`, `suggestions=1`, `exclude` (comma-separated ids to
 * leave out: the ones skipped), `limit` (default 3, at most QUEUE_LIMIT_MAX).
 */
async function GET__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const q = parseQueueQuery(new URL(req.url).searchParams, QUEUE_LIMIT_MAX);
  const bank = (await getAppDb()).crosswordBank;
  const [words, pool] = await Promise.all([bank.approvalQueue(q), bank.poolCounts()]);
  const body: ApproveNextResponse = { words, pool };
  return NextResponse.json(body, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
