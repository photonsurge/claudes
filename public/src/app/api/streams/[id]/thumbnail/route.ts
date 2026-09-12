import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * POST /api/streams/:id/thumbnail — (re)upload the run's thumbnail onto its
 * YouTube video, now. The worker fetches + letterboxes the image and holds the
 * YouTube credentials, so this awaits run-lifecycle.thumbnail with `force`
 * (re-uploads even if already set; resolves with a structured ok/skipped/error
 * rather than rejecting). Always 200 so the button can show the reason. The
 * automatic upload happens at go-live regardless of this route.
 */
async function POST__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  try {
    const result = await sendToQueueAndWait("stream", "run-lifecycle", "thumbnail", { runId: id, force: true }, 60_000);
    return NextResponse.json(result, { status: 200, headers: NO_CACHE });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 200, headers: NO_CACHE });
  }
}

export const POST = withApiLog(POST__impl);
