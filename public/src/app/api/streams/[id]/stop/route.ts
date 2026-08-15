import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";
import { runIsFinished, toRunState, type Run } from "@photonsurge/shared/runs";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * POST /api/streams/:id/stop — operator stop. Enqueues the worker `run-lifecycle.stop`
 * job, which transitions YouTube→complete, stops OBS, and cancels the pending
 * auto-end delayed job. Public only enqueues (the worker holds the credentials).
 */
async function POST__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const run = await db.getRun(id);
  if (!run) {
    return NextResponse.json({ error: "no such run" }, { status: 404, headers: NO_CACHE });
  }
  if (runIsFinished(run.status)) {
    return NextResponse.json(toRunState(run as Run), { status: 200, headers: NO_CACHE });
  }
  // A slot-owned run: stopping it manually must ALSO disable the slot, or the
  // reconciler would treat the standing order as unmet and restart the stream.
  let slotDisabled: string | undefined;
  if (run.slotId) {
    const slot = await db.getStreamSlot(run.slotId);
    if (slot?.enabled) {
      await db.saveStreamSlot({ id: slot.id, enabled: false });
      slotDisabled = slot.id;
    }
  }
  await sendToFore("stream", "run-lifecycle", "stop", { runId: id });
  return NextResponse.json({ ok: true, id, slotDisabled }, { status: 202, headers: NO_CACHE });
}

export const POST = withApiLog(POST__impl);
