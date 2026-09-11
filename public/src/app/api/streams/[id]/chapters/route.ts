import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * POST /api/streams/:id/chapters — (re)publish the as-run chapters into the
 * run's YouTube video description, now. The worker owns the YouTube
 * credentials and the timeline loader, so this awaits run-lifecycle.chapters
 * with `force` (re-publishes even if already done; resolves with a structured
 * ok/skipped/error rather than rejecting). Always 200 so the button can show
 * the reason. Automatic publishing happens at run end regardless of this route.
 */
async function POST__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  try {
    const result = await sendToQueueAndWait("stream", "run-lifecycle", "chapters", { runId: id, force: true }, 30_000);
    return NextResponse.json(result, { status: 200, headers: NO_CACHE });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 200, headers: NO_CACHE });
  }
}

export const POST = withApiLog(POST__impl);
