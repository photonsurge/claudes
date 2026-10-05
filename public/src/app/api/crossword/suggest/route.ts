import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToBack } from "@photonsurge/shared/bull/bull-queue";
import { CROSSWORD_JOB_DOMAIN, CROSSWORD_JOB_TYPE } from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
/** Most words one request may queue (the worker batches them ten to a model call). */
const MAX_WORDS = 50;

/**
 * POST /api/crossword/suggest { wordId } or { wordIds: [...] } — Suggest on the
 * Words detail page and "Suggest for the next N" in the approval queue.
 * Enqueues `crossword.suggest` on the background lane and returns at once; the
 * suggestions show when the job lands. A suggestion is never an approval.
 */
async function POST__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let body: { wordId?: unknown; wordIds?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    /* validated below */
  }
  const raw = Array.isArray(body.wordIds) ? body.wordIds : body.wordId !== undefined ? [body.wordId] : [];
  const wordIds = [...new Set(raw.map((x) => (typeof x === "string" ? x.trim() : "")))];
  if (!wordIds.length || wordIds.some((x) => !x)) {
    return NextResponse.json({ error: "wordId or wordIds (strings) is required" }, { status: 400, headers: NO_CACHE });
  }
  if (wordIds.length > MAX_WORDS) {
    return NextResponse.json({ error: `at most ${MAX_WORDS} words at a time` }, { status: 400, headers: NO_CACHE });
  }
  await sendToBack(CROSSWORD_JOB_DOMAIN, CROSSWORD_JOB_TYPE, "suggest", { wordIds });
  return NextResponse.json({ queued: true, count: wordIds.length }, { status: 202, headers: NO_CACHE });
}

export const POST = withApiLog(POST__impl);
