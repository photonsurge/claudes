import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { CROSSWORD_PUZZLE_STATUSES, type CrosswordPuzzle, type CrosswordPuzzleSource } from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../lib/require-admin";
import type { PuzzleListResponse, PuzzleRow } from "../../../../components/admin/crosswords/puzzles/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

const STATUSES = CROSSWORD_PUZZLE_STATUSES;
const SOURCES: readonly CrosswordPuzzleSource[] = ["seed", "bank", "themed"];
const LIST_LIMIT = 500;

const oneOf = <T extends string>(v: string | null, all: readonly T[]): T | undefined =>
  v && (all as readonly string[]).includes(v) ? (v as T) : undefined;

/** The list row: counts instead of entries, so no answer leaves in a list. */
function toRow(p: CrosswordPuzzle): PuzzleRow {
  const scenes = [...new Set(p.plays.map((x) => x.sceneId))];
  const last = p.plays.reduce((m, x) => Math.max(m, x.startedAt), 0);
  const row: PuzzleRow = {
    id: p.id,
    title: p.title,
    // WP6 rework: puzzles have no theme or model now; the row keeps the field until the page drops it.
    theme: "",
    status: p.status,
    source: p.source,
    createdAt: p.createdAt,
    width: p.width,
    height: p.height,
    words: p.entries.length,
    plays: p.plays.length,
    scenes,
  };
  if (last) row.lastPlayedAt = last;
  return row;
}

/**
 * GET /api/crossword/puzzles[?status=&source=&theme=] — the stock for
 * /admin/crosswords/puzzles, newest first (the latest 500). Status filters in
 * Mongo; source and theme (a case-insensitive substring of theme or title)
 * filter here.
 */
async function GET__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const sp = new URL(req.url).searchParams;
  const status = oneOf(sp.get("status"), STATUSES);
  const source = oneOf(sp.get("source"), SOURCES);
  const theme = (sp.get("theme") ?? "").trim().toLowerCase().slice(0, 60);

  const db = await getAppDb();
  const puzzles = await db.crosswordPuzzles.list({ ...(status ? { status } : {}), limit: LIST_LIMIT });
  const rows = puzzles
    .filter((p) => !source || p.source === source)
    .filter((p) => !theme || p.title.toLowerCase().includes(theme))
    .map(toRow);
  const body: PuzzleListResponse = { puzzles: rows };
  return NextResponse.json(body, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
