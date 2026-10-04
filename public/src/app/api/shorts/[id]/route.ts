import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { SHORTS_PREVIEW_SCENE_ID } from "@photonsurge/shared/short-scenes";
import { requireAdmin } from "../../../../lib/require-admin";
import { NO_CACHE, stopPreviewPlay } from "../preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/shorts/:id — one script, clips and plays included (404 if unknown). */
async function GET__impl(_req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const script = await db.shortScripts.get(id);
  if (!script) return NextResponse.json({ error: "no such script" }, { status: 404, headers: NO_CACHE });
  return NextResponse.json(script, { status: 200, headers: NO_CACHE });
}

/**
 * DELETE /api/shorts/:id — remove a script. If the preview scene is playing
 * it, the play is stopped first so the scene isn't left on a missing script.
 */
async function DELETE__impl(_req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const cfg = await db.getOrInitDirectorConfig(SHORTS_PREVIEW_SCENE_ID);
  if (cfg.mode === "script" && cfg.script?.scriptId === id) await stopPreviewPlay(db);
  const removed = await db.shortScripts.remove(id);
  if (!removed) return NextResponse.json({ error: "no such script" }, { status: 404, headers: NO_CACHE });
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
export const DELETE = withApiLog(DELETE__impl);
