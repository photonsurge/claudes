import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../lib/require-admin";
import { parseBankQuery, type BankWordsResponse } from "../../../../components/admin/crosswords/words/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/crossword/words — one page of the imported word bank for
 * /admin/crosswords/words (docs/crossword-mode-plan.md §8.3), filtered by the
 * page's query string, plus the totals above the list (cached a minute in the
 * repo). `imported: false` when the bank has no words, so the page can say how
 * to import it instead of showing an empty table.
 */
async function GET__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const q = parseBankQuery(new URL(req.url).searchParams);
  const db = await getAppDb();
  const [list, totals] = await Promise.all([db.crosswordBank.listWords(q), db.crosswordBank.totals()]);
  const body: BankWordsResponse = { ...list, totals, imported: totals.total > 0 };
  return NextResponse.json(body, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
