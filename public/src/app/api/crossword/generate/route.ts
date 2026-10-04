import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToBack } from "@photonsurge/shared/bull/bull-queue";
import { CROSSWORD_JOB_DOMAIN, CROSSWORD_JOB_TYPE, type CrosswordGenerateRequest } from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

const THEME_MAX = 60;

/**
 * POST /api/crossword/generate { sceneId, theme? } — Generate now on
 * /admin/crosswords/puzzles. Enqueues `crossword.generate` on the background
 * lane and returns at once: a build lays out a grid and may call a model, and
 * the new puzzle shows in the list when it lands (draft, or ready under the
 * scene's auto-approve).
 */
async function POST__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let body: { sceneId?: unknown; theme?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    /* validated below */
  }
  const sceneId = typeof body.sceneId === "string" ? body.sceneId.trim() : "";
  if (!sceneId) return NextResponse.json({ error: "sceneId is required" }, { status: 400, headers: NO_CACHE });
  const theme = typeof body.theme === "string" ? body.theme.replace(/\s+/g, " ").trim() : "";
  if (theme.length > THEME_MAX) {
    return NextResponse.json({ error: `theme is at most ${THEME_MAX} characters` }, { status: 400, headers: NO_CACHE });
  }

  const db = await getAppDb();
  if (!(await db.crosswordScenes()).includes(sceneId)) {
    return NextResponse.json({ error: "no such crossword channel" }, { status: 404, headers: NO_CACHE });
  }
  // WP6 rework: puzzles have no theme now (§4.1); a theme in the body is checked and ignored.
  const data: CrosswordGenerateRequest = { sceneId };
  await sendToBack(CROSSWORD_JOB_DOMAIN, CROSSWORD_JOB_TYPE, "generate", data);
  return NextResponse.json({ queued: true }, { status: 202, headers: NO_CACHE });
}

export const POST = withApiLog(POST__impl);
