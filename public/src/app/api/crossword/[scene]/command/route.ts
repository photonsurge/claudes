import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";
import {
  CROSSWORD_COMMANDS,
  CROSSWORD_JOB_DOMAIN,
  CROSSWORD_JOB_TYPE,
  type CrosswordCommand,
  type CrosswordInject,
} from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ scene: string }> };

const isCommand = (v: unknown): v is CrosswordCommand =>
  typeof v === "string" && (CROSSWORD_COMMANDS as readonly string[]).includes(v);

/**
 * POST /api/crossword/:scene/command { command } — a Desk control (pause,
 * resume, skipClue, reveal, nextPuzzle). Enqueues `crossword.inject` on the
 * foreground lane; the runner applies it on its next tick. An identical
 * command still waiting is not queued twice (a double click skips one clue).
 */
async function POST__impl(req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { scene } = await params;
  let body: { command?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    /* validated below */
  }
  if (!isCommand(body.command)) {
    return NextResponse.json(
      { error: `command must be one of ${CROSSWORD_COMMANDS.join(", ")}` },
      { status: 400, headers: NO_CACHE },
    );
  }

  const db = await getAppDb();
  if (!(await db.crosswordScenes()).includes(scene)) {
    return NextResponse.json({ error: "no such crossword channel" }, { status: 404, headers: NO_CACHE });
  }
  const payload: CrosswordInject = { sceneId: scene, kind: "command", command: body.command };
  await sendToFore(CROSSWORD_JOB_DOMAIN, CROSSWORD_JOB_TYPE, "inject", payload);
  return NextResponse.json({ queued: true }, { status: 202, headers: NO_CACHE });
}

export const POST = withApiLog(POST__impl);
