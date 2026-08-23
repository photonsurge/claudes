import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../lib/require-admin";
import { publicOrigin } from "../../../lib/public-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "yt_oauth_state";

/**
 * GET /google/redirect — the Google OAuth callback. Google redirects back here with
 * `code` + `state`. We verify the CSRF `state` against the cookie, then delegate the
 * code→token exchange to the WORKER (`youtube.exchangeCode`), so the client secret +
 * refresh token + encryption key never enter this process. Redirects to /admin/streams.
 *
 * Path note: this deliberately sits at `/google/redirect` (not under /api) to match the
 * redirect URI already registered on the Google OAuth client — Google validates the
 * callback URL exactly, so the app moved to fit the registration rather than the other
 * way round. Keep this path and `YOUTUBE_REDIRECT_URI` in step.
 */
async function GET__impl(req: Request) {
  const session = await requireAdmin();
  const url = new URL(req.url);
  // Land back on the real public origin, not the container's 0.0.0.0 bind host.
  const back = (q: string) => NextResponse.redirect(new URL(`/admin/youtube?${q}`, publicOrigin(req)));

  if (!session) return back("error=admin");

  const err = url.searchParams.get("error");
  if (err) return back(`error=${encodeURIComponent(err)}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = (await cookies()).get(STATE_COOKIE)?.value;

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
