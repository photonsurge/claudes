import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "yt_oauth_state";

/**
 * GET /api/youtube/callback — Google redirects back here with `code` + `state`.
 * We verify the CSRF `state` against the cookie, then delegate the code→token
 * exchange to the WORKER (`youtube.exchangeCode`), so the client secret + refresh
 * token + encryption key never enter this process. Redirects to /admin/streams.
 */
async function GET__impl(req: Request) {
  const session = await requireAdmin();
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/admin/streams?${q}`, req.url));

  if (!session) return back("error=admin");

  const err = url.searchParams.get("error");
  if (err) return back(`error=${encodeURIComponent(err)}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = (await cookies()).get(STATE_COOKIE)?.value;

  const res = back("connected=1");
  res.cookies.delete(STATE_COOKIE);

  if (!code || !state || !cookieState || state !== cookieState) {
    return back("error=state");
  }

  try {
    const result = await sendToQueueAndWait<{ channelId: string; channelTitle: string }>(
      "stream",
      "youtube",
      "exchangeCode",
      { code, connectedBy: session.email },
      30_000,
    );
    const ok = back(`connected=${encodeURIComponent(result.channelTitle || result.channelId)}`);
    ok.cookies.delete(STATE_COOKIE);
    return ok;
  } catch (e) {
    const fail = back(`error=${encodeURIComponent(String((e as Error)?.message ?? e).slice(0, 120))}`);
    fail.cookies.delete(STATE_COOKIE);
    return fail;
  }
}

export const GET = withApiLog(GET__impl);
