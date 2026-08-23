import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * POST /api/streams/encoders/:id/refresh — force a no-cache reload of this encoder's
 * globe browser source (the OBS "Refresh" button), e.g. to pick up a new /watch
 * bundle after a deploy without re-switching scenes. Delegated to the worker
 * (run-lifecycle.refreshEncoder). Always 200 with a { ok, ... } body.
 */
async function POST__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  try {
    const result = await sendToQueueAndWait("stream", "run-lifecycle", "refreshEncoder", { encoderId: id }, 15_000);
    return NextResponse.json(result, { status: 200, headers: NO_CACHE });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 200, headers: NO_CACHE });
  }
}

export const POST = withApiLog(POST__impl);
