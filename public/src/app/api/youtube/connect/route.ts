import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { YOUTUBE_OAUTH_SCOPES } from "@photonsurge/shared/runs";
import { requireAdmin } from "../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "yt_oauth_state";

/**
 * GET /api/youtube/connect — kick off the YouTube OAuth consent flow. Builds the
 * Google consent URL by hand (no library, so `public` gains no googleapis dep),
 * stashes a CSRF nonce in an httpOnly cookie, and 302s the operator to Google.
 * The client SECRET stays in the worker — only the (non-secret) client id is used
 * here. `access_type=offline` + `prompt=consent` guarantee a refresh token.
 */
async function GET__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/admin/streams?error=notconfigured", req.url));
  }
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || new URL("/api/youtube/callback", req.url).toString();
  const state = randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // survives Google's top-level GET redirect back
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}

export const GET = withApiLog(GET__impl);
