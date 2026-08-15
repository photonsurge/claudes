import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";
import { runIsActive } from "@photonsurge/shared/runs";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * DELETE /api/streams/slots/:id — remove a persistent-stream slot. Any run it
 * started is ended too (a deleted standing order shouldn't leave its stream
 * running unowned).
 */
async function DELETE__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const slot = await db.getStreamSlot(id);
  if (!slot) {
    return NextResponse.json({ error: "no such slot" }, { status: 404, headers: NO_CACHE });
  }
  if (slot.runId) {
    const run = await db.getRun(slot.runId);
    if (run && runIsActive(run.status)) {
      await sendToFore("stream", "run-lifecycle", "stop", { runId: run.id });
    }
  }
  const ok = await db.deleteStreamSlot(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 500, headers: NO_CACHE });
}

export const DELETE = withApiLog(DELETE__impl);
