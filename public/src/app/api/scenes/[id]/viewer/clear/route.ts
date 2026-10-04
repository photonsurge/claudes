import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/scenes/:id/viewer/clear — the operator's "Clear all" for viewer picks (the worker owns the doc). */
async function POST__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await sendToFore("scenes", "viewer-chat", "clear", { sceneId: id });
  return NextResponse.json({ queued: true }, { status: 202 });
}

// --- request logging (lib/api-log) ---
export const POST = withApiLog(POST__impl);
