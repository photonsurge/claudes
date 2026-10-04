import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";
import {
  CROSSWORD_JOB_DOMAIN,
  CROSSWORD_JOB_TYPE,
  MAX_GUESS_CHARS,
  type CrosswordInject,
} from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** Longest simulator name accepted; the worker cleans it to the on-air limit. */
const SIM_NAME_MAX = 40;

type Ctx = { params: Promise<{ scene: string }> };

/**
 * POST /api/crossword/:scene/sim { name, text } — the Desk's "say as viewer"
 * (docs/crossword-mode-plan.md §8.3). Enqueues `crossword.inject` on the
 * foreground lane; the worker runs it through the same handler as a YouTube
 * message, marked `sim`, and writes no chat log. `at` is stamped here so the
 * answer is timed when it was typed, and it keeps two identical guesses from
 * deduplicating into one job.
 */
async function POST__impl(req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { scene } = await params;
  let body: { name?: unknown; text?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    /* validated below */
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400, headers: NO_CACHE });
  if (name.length > SIM_NAME_MAX) {
    return NextResponse.json({ error: `name is at most ${SIM_NAME_MAX} characters` }, { status: 400, headers: NO_CACHE });
  }
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400, headers: NO_CACHE });
  if (text.length > MAX_GUESS_CHARS) {
    return NextResponse.json(
      { error: `text is at most ${MAX_GUESS_CHARS} characters (longer chat messages are ignored as answers)` },
      { status: 400, headers: NO_CACHE },
    );
  }

  const db = await getAppDb();
  if (!(await db.crosswordScenes()).includes(scene)) {
    return NextResponse.json({ error: "no such crossword channel" }, { status: 404, headers: NO_CACHE });
  }
  const payload: CrosswordInject = { sceneId: scene, kind: "sim", name, text, at: Date.now() };
  await sendToFore(CROSSWORD_JOB_DOMAIN, CROSSWORD_JOB_TYPE, "inject", payload);
  return NextResponse.json({ queued: true }, { status: 202, headers: NO_CACHE });
}

export const POST = withApiLog(POST__impl);
