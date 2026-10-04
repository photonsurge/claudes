import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/director/:scene/commands/:id — drop one still-queued command. */
async function DELETE__impl(_req: Request, { params }: { params: Promise<{ scene: string; id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { scene, id } = await params;
  const db = await getAppDb();
  const cmd = await db.directorCommands.get(id);
  if (!cmd || cmd.sceneId !== scene) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const dropped = await db.directorCommands.drop(id, Date.now());
  return NextResponse.json({ dropped }, { status: dropped ? 200 : 409 });
}

// --- request logging (lib/api-log) ---
export const DELETE = withApiLog(DELETE__impl);
