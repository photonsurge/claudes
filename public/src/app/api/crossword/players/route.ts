import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { CrosswordPlayerRow } from "@photonsurge/shared/crossword-records";
import { requireAdmin } from "../../../../lib/require-admin";
import type { PlayerListResponse } from "../../../../components/admin/crosswords/puzzles/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

const LIST_LIMIT = 1000;

/**
 * GET /api/crossword/players[?search=] — /admin/crosswords/players: every
 * player (most recently seen first) with all-time points and words across
 * every crossword channel. Hidden players keep their totals here, so the
 * operator can see what unhiding would put back on the boards.
 */
async function GET__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const search = (new URL(req.url).searchParams.get("search") ?? "").trim().slice(0, 40);
  const db = await getAppDb();
  const [players, board] = await Promise.all([
    db.crosswordPlayers.list({ limit: LIST_LIMIT, ...(search ? { search } : {}) }),
    db.crosswordSolves.board({}),
  ]);
  const totals = new Map(board.map((r) => [r.playerId, r]));
  const rows: CrosswordPlayerRow[] = players.map((p) => ({
    ...p,
    points: totals.get(p.id)?.points ?? 0,
    words: totals.get(p.id)?.words ?? 0,
  }));
  const body: PlayerListResponse = { players: rows };
  return NextResponse.json(body, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
