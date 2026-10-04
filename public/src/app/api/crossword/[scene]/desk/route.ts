import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sceneSurface } from "@photonsurge/shared/control";
import { crosswordStockReason, type CrosswordStockReason } from "@photonsurge/shared/crossword";
import type { BankPoolCounts } from "@photonsurge/shared/crossword-bank";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

export interface CrosswordDeskResponse {
  /** Why the channel is on what it is on, or idle (§7.5) — the runner's own reason. */
  reason: CrosswordStockReason;
  /** The approved pool (§7.4 counter); null when the bank could not be read. */
  pool: BankPoolCounts | null;
}

/**
 * GET /api/crossword/:scene/desk — what the Desk says beside the board: the
 * structured stock reason (`crosswordStockReason`, the same one the runner
 * logs) over the ready stock, the puzzle on air and the channel's config, and
 * the approved-pool counts. Admin only; 404 for a scene that is not a
 * crossword channel.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ scene: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE });
  const { scene } = await params;
  const db = await getAppDb();
  const meta = await db.getScene(scene);
  if (!meta || sceneSurface(meta as { surface?: unknown }) !== "crossword") {
    return NextResponse.json({ error: "no such crossword channel" }, { status: 404, headers: NO_CACHE });
  }
  const [ready, game, cfg, pool] = await Promise.all([
    db.crosswordPuzzles.list({ status: "ready" }),
    db.crosswordGames.get(scene),
    db.getOrInitCrosswordConfig(scene),
    db.crosswordBank.poolCounts().catch(() => null),
  ]);
  const reason = crosswordStockReason(ready, scene, game?.phase === "idle" ? "" : (game?.puzzleId ?? ""), {
    familyFriendlyOnly: cfg.familyFriendlyOnly,
    noRepeatPuzzles: cfg.noRepeatPuzzles,
    // The worker's switch; set on the same box for both in dev.
    allowUnapproved: process.env.CROSSWORD_ALLOW_UNAPPROVED === "true",
  });
  const body: CrosswordDeskResponse = { reason, pool };
  return NextResponse.json(body, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
