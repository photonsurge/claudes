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
  // Generic GOOGLE_OAUTH_* names (client shared with the other photonsurge apps),
  // falling back to the YOUTUBE_* names.
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/admin/streams?error=notconfigured", req.url));
  }
  // Must exactly match a redirect URI registered on the Google OAuth client. The
  // app's callback lives at /google/redirect (see app/google/redirect/route.ts).
  // Prefer the pinned env var — it's the ONLY thing the worker's token exchange
  // reads, and Google requires the auth-request and token-request redirect_uri to
  // agree. The derived fallback exists only for a not-yet-configured dev box; guard
  // the 0.0.0.0 bind host (from the standalone HOSTNAME fix) so it never leaks a URI
  // Google will reject — swap it for localhost, which Google accepts over http.
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    process.env.YOUTUBE_REDIRECT_URI ||
    (() => {
      const u = new URL("/google/redirect", req.url);
      if (u.hostname === "0.0.0.0") u.hostname = "localhost";
      return u.toString();
    })();
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
