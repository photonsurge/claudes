import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * POST /api/streams/encoders/:id/test — read-only OBS reachability probe. The
 * worker holds the obs-websocket connection and decrypts the stored password, so
 * this delegates to it (run-lifecycle.testEncoder): connect, read GetVersion +
 * GetStreamStatus, report back. NO StartStream — safe against a live encoder.
 * Always 200 with a { reachable, ... } body so the UI can show the failure reason.
 */
async function POST__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  try {
    const result = await sendToQueueAndWait("stream", "run-lifecycle", "testEncoder", { encoderId: id }, 12_000);
    return NextResponse.json(result, { status: 200, headers: NO_CACHE });
  } catch (e) {
    // A queue timeout (worker down / job never ran) also lands here — report it as
    // unreachable rather than a 500 so the operator sees a clear reason.
    return NextResponse.json(
      { reachable: false, error: String((e as Error)?.message ?? e) },
      { status: 200, headers: NO_CACHE },
    );
  }
}

export const POST = withApiLog(POST__impl);
