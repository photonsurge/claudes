import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/crossword/words/:id — one bank word for its detail page: senses,
 * every clue, the validation verdict and the raw JSON (404 if unknown or not
 * an ObjectId). Read-only; the decisions are a later package.
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

export const GET = withApiLog(GET__impl);
