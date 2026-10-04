import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { OPERATOR_COMMAND_TTL_MS, validateOp } from "@photonsurge/shared/director-commands";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/director/:scene/commands?since=&limit= — the scene's command log,
 * newest first. Admin only: it names operators and viewers. (proxy.ts lets
 * GETs under /api/director through anonymously for /watch, so this gates
 * itself.)
 */
async function GET__impl(req: Request, { params }: { params: Promise<{ scene: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { scene } = await params;
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since")) || undefined;
  const limit = Number(url.searchParams.get("limit")) || undefined;
  const db = await getAppDb();
  const commands = await db.directorCommands.recent(scene, { since, limit });
  return NextResponse.json({ commands }, { status: 200, headers: NO_CACHE });
}

/**
 * POST /api/director/:scene/commands — enqueue an operator command
 * (shared/director-commands.ts DirectorOp). Refused at the door (and logged as
 * refused) when the scene's director is not in Auto: no loop is running to
 * act on it.
 */
async function POST__impl(req: Request, { params }: { params: Promise<{ scene: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { scene } = await params;
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* falls through to the validation error */
  }
  const cmd = validateOp(body);
  if (!cmd) return NextResponse.json({ error: "Invalid command" }, { status: 400 });

  const db = await getAppDb();
  const cfg = await db.getOrInitDirectorConfig(scene);
  const now = Date.now();
  const source = { kind: "operator" as const, user: session.email || session.sub };
  if (cfg.mode !== "auto") {
    const refused = await db.directorCommands.enqueue({
      sceneId: scene,
      source,
      cmd,
      now,
      ttlMs: OPERATOR_COMMAND_TTL_MS,
      status: "refused",
      note: cfg.mode === "script" ? "a scripted video is playing" : "director is off",
    });
    return NextResponse.json({ command: refused }, { status: 409, headers: NO_CACHE });
  }
  const command = await db.directorCommands.enqueue({ sceneId: scene, source, cmd, now, ttlMs: OPERATOR_COMMAND_TTL_MS });
  return NextResponse.json({ command }, { status: 202, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
