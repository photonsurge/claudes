import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { BANK_APPROVAL_STATUSES } from "@photonsurge/shared/crossword-bank";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/crossword/words/:id — one bank word for its detail page: senses,
 * every clue, the validation verdict and the raw JSON (404 if unknown or not
 * an ObjectId).
 */
async function GET__impl(_req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const word = await db.crosswordBank.getWordById(id);
  if (!word) return NextResponse.json({ error: "no such word" }, { status: 404, headers: NO_CACHE });
  return NextResponse.json(word, { status: 200, headers: NO_CACHE });
}

/**
 * PATCH /api/crossword/words/:id — the word-level decisions (§7.4, §8.4). Body,
 * any of:
 *
 *  • `approval`: "pending" | "approved" | "rejected";
 *  • `familyFriendly`: true | false | null (null untags);
 *  • `acceptSuggestion: true`: save the stored suggestion's clue as a new
 *    pending candidate clue. Never approves anything.
 *
 * Who decided is the admin's session identity. 200 with the updated word;
 * 400 for an empty or malformed body, 404 for an unknown word.
 */
async function PATCH__impl(req: Request, { params }: Ctx) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  let body: { approval?: unknown; familyFriendly?: unknown; acceptSuggestion?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    /* validated below */
  }
  const hasApproval = body.approval !== undefined;
  const hasTag = body.familyFriendly !== undefined;
  const accept = body.acceptSuggestion === true;
  if (!hasApproval && !hasTag && !accept) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400, headers: NO_CACHE });
  }
  if (hasApproval && !(BANK_APPROVAL_STATUSES as readonly unknown[]).includes(body.approval)) {
    return NextResponse.json({ error: "approval must be pending, approved or rejected" }, { status: 400, headers: NO_CACHE });
  }
  if (hasTag && body.familyFriendly !== null && typeof body.familyFriendly !== "boolean") {
    return NextResponse.json({ error: "familyFriendly must be true, false or null" }, { status: 400, headers: NO_CACHE });
  }
  const by = session.email || session.sub;
  const db = await getAppDb();
  const bank = db.crosswordBank;
  const word = await bank.getWordById(id);
  if (!word) return NextResponse.json({ error: "no such word" }, { status: 404, headers: NO_CACHE });

  if (hasApproval) await bank.setWordApproval(id, body.approval as "pending" | "approved" | "rejected", by);
  if (hasTag) await bank.setWordFamilyFriendly(id, body.familyFriendly as boolean | null, by);
  if (accept) {
    if (!word.suggestion) return NextResponse.json({ error: "no suggestion stored" }, { status: 409, headers: NO_CACHE });
    await bank.addClues(id, [word.suggestion.clue], { source: "suggestion", model: word.suggestion.model || undefined });
  }
  const updated = await bank.getWordById(id);
  return NextResponse.json(updated ?? word, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
export const PATCH = withApiLog(PATCH__impl);
