import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_CROSSWORD_CONFIG, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../../lib/require-admin";
import { dropEntry, editClue, type EditResult } from "./edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ id: string }> };
type Db = Awaited<ReturnType<typeof getAppDb>>;

/**
 * What the crossword channels' configs say about editing a puzzle, which
 * belongs to no one channel: the union of their blocklists, the lowest
 * `minWords` (so a puzzle any channel can play stays editable), and the
 * channels on air with this puzzle right now.
 */
async function channelPolicy(db: Db, puzzleId: string) {
  const scenes = await db.crosswordScenes();
  const [configs, games] = await Promise.all([
    Promise.all(scenes.map((s) => db.getOrInitCrosswordConfig(s))),
    Promise.all(scenes.map((s) => db.crosswordGames.get(s))),
  ]);
  return {
    blocklist: [...new Set(configs.flatMap((c) => c.blocklist))],
    minWords: configs.length ? Math.min(...configs.map((c) => c.minWords)) : DEFAULT_CROSSWORD_CONFIG.minWords,
    playingOn: scenes.filter((_, i) => games[i]?.puzzleId === puzzleId && games[i]?.phase !== "idle"),
  };
}

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
 * PATCH /api/crossword/puzzles/:id — the review actions on
 * /admin/crosswords/puzzles/:id. Body is one of:
 *
 *  • `{ action: "approve" }` → status `ready` (it joins the stock);
 *  • `{ action: "reject" }` → status `rejected` (never picked);
 *  • `{ action: "clue", entryId, clue }` → `cleanClue` + `validateClue`, 422 with
 *    the problem if it can't air;
 *  • `{ action: "drop", entryId }` → remove the word and renumber (see edit.ts);
 *    422 if that splits the grid or leaves too few words, 409 while a channel
 *    is playing the puzzle (the runner's game is keyed by the entry ids).
 *
 * 200 with the updated puzzle.
 */
async function PATCH__impl(req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  let body: { action?: unknown; entryId?: unknown; clue?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    /* validated below */
  }

  const db = await getAppDb();
  const puzzle = await db.crosswordPuzzles.get(id);
  if (!puzzle) return NextResponse.json({ error: "no such puzzle" }, { status: 404, headers: NO_CACHE });

  const ok = (p: CrosswordPuzzle) => NextResponse.json(p, { status: 200, headers: NO_CACHE });
  const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_CACHE });

  switch (body.action) {
    case "approve":
    case "reject": {
      const status = body.action === "approve" ? "ready" : "rejected";
      await db.crosswordPuzzles.setStatus(id, status);
      return ok({ ...puzzle, status });
    }
    case "clue":
    case "drop": {
      if (typeof body.entryId !== "string" || !body.entryId) return bad("entryId is required");
      const policy = await channelPolicy(db, id);
      let result: EditResult;
      if (body.action === "clue") {
        if (typeof body.clue !== "string") return bad("clue is required");
        result = editClue(puzzle, body.entryId, body.clue, policy.blocklist);
      } else {
        if (policy.playingOn.length) {
          return bad(`${policy.playingOn.join(", ")} is playing this puzzle now; drop words once it has moved on.`, 409);
        }
        result = dropEntry(puzzle, body.entryId, policy.minWords);
      }
      if (!result.ok) return bad(result.error, 422);
      return ok(await db.crosswordPuzzles.upsert(result.puzzle));
    }
    default:
      return bad('action must be "approve", "reject", "clue" or "drop"');
  }
}

export const GET = withApiLog(GET__impl);
export const PATCH = withApiLog(PATCH__impl);
