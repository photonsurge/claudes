import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * POST /api/streams/encoders/:id/provision — full auto-provision this encoder's OBS:
 * the worker builds the channel's tokened /watch URL, pushes a full-canvas browser
 * source into that OBS instance, and switches to it. Delegated to the worker
 * (run-lifecycle.provisionEncoder) because it holds the obs-websocket connection and
 * decrypts the password. Always 200 with a { ok, ... } body so the UI shows the reason.
 */
async function POST__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  try {
    const result = await sendToQueueAndWait("stream", "run-lifecycle", "provisionEncoder", { encoderId: id }, 20_000);
    return NextResponse.json(result, { status: 200, headers: NO_CACHE });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 200, headers: NO_CACHE });
  }
}

export const POST = withApiLog(POST__impl);
