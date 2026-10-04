import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
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
 *  • `text`: edit the clue. An approved clue goes back to pending and its tag is
 *    cleared (the repo's rule), so an edit is applied first and a decision in
 *    the same body lands on the edited clue;
 *  • `approval`: "pending" | "approved" | "rejected";
 *  • `familyFriendly`: true | false | null (null untags).
 *
 * Who decided is the admin's session identity. 200 `{ ok: true }`; 400 for an
 * empty or malformed body, 404 for an unknown clue.
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
  const bank = (await getAppDb()).crosswordBank;
  const found = async (p: Promise<boolean>) => {
    if (!(await p)) throw new NotFound();
  };
  try {
    if (hasText) await found(bank.editClue(id, body.text as string, by));
    if (hasApproval) await found(bank.setClueApproval(id, body.approval as BankApprovalStatus, by));
    if (hasTag) await found(bank.setClueFamilyFriendly(id, body.familyFriendly as boolean | null, by));
  } catch (err) {
    if (err instanceof NotFound) return NextResponse.json({ error: "no such clue" }, { status: 404, headers: NO_CACHE });
    throw err;
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_CACHE });
}

class NotFound extends Error {}

export const PATCH = withApiLog(PATCH__impl);
