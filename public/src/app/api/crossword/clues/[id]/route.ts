import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb, type CrosswordCascade } from "@photonsurge/shared/db/index";
import { cleanClue, validateClue } from "@photonsurge/shared/crossword";
import { BANK_APPROVAL_STATUSES, type BankApprovalStatus } from "@photonsurge/shared/crossword-bank";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/crossword/clues/:id — the clue-level decisions (§7.4, §8.4). Body,
 * any of:
 *
 *  • `text`: edit the clue, stored after `cleanClue` (what an approval in the
 *    same body is checked against). An approved clue goes back to pending and its tag is
 *    cleared (the repo's rule), so an edit is applied first and a decision in
 *    the same body lands on the edited clue;
 *  • `approval`: "pending" | "approved" | "rejected";
 *  • `familyFriendly`: true | false | null (null untags);
 *
 * Every decision goes through the db facade, so it reaches built puzzles:
 * a clue rejected, returned to pending or edited takes every ready puzzle
 * using it out of play, and a tag taken off clears their family-friendly flag.
 *
 * Approving a clue that `validateClue` refuses (after `cleanClue`, against the
 * answer of its word, read with `getClue`; the built-in blocklist only, since
 * channel blocklists vary) is a 409 with the `problem`. An `X-Word-Id` header
 * (sent by older clients) is accepted and ignored. Who decided is the admin's
 * session identity. 200 `{ ok: true, rejected, untagged }` (the puzzles
 * changed); 400 for an empty or malformed body, 404 for an unknown clue.
 */
async function PATCH__impl(req: Request, { params }: Ctx) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  let body: { text?: unknown; approval?: unknown; familyFriendly?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    /* validated below */
  }
  const hasText = body.text !== undefined;
  const hasApproval = body.approval !== undefined;
  const hasTag = body.familyFriendly !== undefined;
  if (!hasText && !hasApproval && !hasTag) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400, headers: NO_CACHE });
  }
  if (hasText && (typeof body.text !== "string" || !body.text.trim())) {
    return NextResponse.json({ error: "text must be a non-empty string" }, { status: 400, headers: NO_CACHE });
  }
  if (hasApproval && !(BANK_APPROVAL_STATUSES as readonly unknown[]).includes(body.approval)) {
    return NextResponse.json({ error: "approval must be pending, approved or rejected" }, { status: 400, headers: NO_CACHE });
  }
  if (hasTag && body.familyFriendly !== null && typeof body.familyFriendly !== "boolean") {
    return NextResponse.json({ error: "familyFriendly must be true, false or null" }, { status: 400, headers: NO_CACHE });
  }
  const by = session.email || session.sub;
  const db = await getAppDb();
  if (body.approval === "approved") {
    const clue = await db.crosswordBank.getClue(id);
    if (!clue) return NextResponse.json({ error: "no such clue" }, { status: 404, headers: NO_CACHE });
    const text = hasText ? (body.text as string) : clue.text;
    const problem = validateClue(cleanClue(text), clue.answer);
    if (problem) return NextResponse.json({ error: `clue cannot air: ${problem}`, problem }, { status: 409, headers: NO_CACHE });
  }
  const rejected = new Set<string>();
  const untagged = new Set<string>();
  const found = async (p: Promise<CrosswordCascade>) => {
    const r = await p;
    if (!r.ok) throw new NotFound();
    r.rejected.forEach((x) => rejected.add(x));
    r.untagged.forEach((x) => untagged.add(x));
  };
  try {
    // Stored as cleaned, the text the approval check validated (the repo keeps the first original).
    if (hasText) await found(db.editCrosswordClue(id, cleanClue(body.text as string) || (body.text as string), by));
    if (hasApproval) await found(db.setCrosswordClueApproval(id, body.approval as BankApprovalStatus, by));
    if (hasTag) await found(db.setCrosswordClueFamilyFriendly(id, body.familyFriendly as boolean | null, by));
  } catch (err) {
    if (err instanceof NotFound) return NextResponse.json({ error: "no such clue" }, { status: 404, headers: NO_CACHE });
    throw err;
  }
  return NextResponse.json({ ok: true, rejected: [...rejected], untagged: [...untagged] }, { status: 200, headers: NO_CACHE });
}

class NotFound extends Error {}

export const PATCH = withApiLog(PATCH__impl);
