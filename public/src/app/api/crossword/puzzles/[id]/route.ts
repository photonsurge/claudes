import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/crossword/puzzles/:id — one puzzle with its answers (admin only; 404 if unknown). */
async function GET__impl(_req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const puzzle = await db.crosswordPuzzles.get(id);
  if (!puzzle) return NextResponse.json({ error: "no such puzzle" }, { status: 404, headers: NO_CACHE });
  return NextResponse.json(puzzle, { status: 200, headers: NO_CACHE });
}

/**
 * PATCH /api/crossword/puzzles/:id — the only review actions (§8.3). Body is
 * `{ action: "reject" }` → status `rejected` (out of play), or
 * `{ action: "unreject" }` → back to `ready`, so a mistaken reject is
 * undone. A puzzle is built only from approved words and clues, so nothing
 * here approves, and a puzzle's clues are not edited here: that is Words.
 * 200 with the updated puzzle.
 */
async function PATCH__impl(req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  let body: { action?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    /* validated below */
  }
  if (body.action !== "reject" && body.action !== "unreject") {
    return NextResponse.json({ error: 'action must be "reject" or "unreject"' }, { status: 400, headers: NO_CACHE });
  }

  const db = await getAppDb();
  const puzzle = await db.crosswordPuzzles.get(id);
  if (!puzzle) return NextResponse.json({ error: "no such puzzle" }, { status: 404, headers: NO_CACHE });

  const status = body.action === "reject" ? "rejected" : "ready";
  await db.crosswordPuzzles.setStatus(id, status);
  return NextResponse.json({ ...puzzle, status }, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
export const PATCH = withApiLog(PATCH__impl);
