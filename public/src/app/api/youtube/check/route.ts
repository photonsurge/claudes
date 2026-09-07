import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * POST /api/youtube/check { channelId? } — "is the YouTube connection alive?"
 * The worker holds the refresh token, so this delegates to `youtube.check`: mint
 * an access token from the stored refresh token (the step that fails with
 * `invalid_grant` when the token is dead) + one 1-unit API call, and report
 * today's quota spend. Always 200 with a structured { ok, tokenOk, apiOk, … } body
 * so the UI can show the failure reason.
 */
async function POST__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let channelId: string | undefined;
  try {
    const body = (await req.json()) ?? {};
    channelId = body.channelId ? String(body.channelId) : undefined;
  } catch {
    /* no body → default channel */
  }
  try {
    const result = await sendToQueueAndWait("stream", "youtube", "check", { accountId: channelId }, 25_000);
    return NextResponse.json(result, { status: 200, headers: NO_CACHE });
  } catch (e) {
    // A queue timeout (worker down / job never ran) also lands here.
    return NextResponse.json(
      { ok: false, configured: true, tokenOk: false, apiOk: false, error: String((e as Error)?.message ?? e) },
      { status: 200, headers: NO_CACHE },
    );
  }
}

export const POST = withApiLog(POST__impl);
