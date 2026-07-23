import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/youtube — admin diagnostics + connected channels for /admin/youtube.
 * Surfaces exactly what's wired (client id, the effective redirect URI to paste
 * into Google, token-encryption + OBS status) so a misconfig is visible instead of
 * a cryptic OAuth error. Non-secret only: the client id is public, the secret is
 * reported as a boolean, no token is ever returned.
 */
async function GET__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID || null;
  const clientSecret = process.env.GOOGLE_OAUTH_SECRET || process.env.YOUTUBE_CLIENT_SECRET || null;
  const redirectFromEnv = process.env.GOOGLE_OAUTH_REDIRECT_URI || process.env.YOUTUBE_REDIRECT_URI || null;
  const redirectUri = redirectFromEnv || new URL("/google/redirect", req.url).toString();

  const db = await getAppDb();
  const accounts = await db.listYoutubeAccounts();

  return NextResponse.json(
    {
      configured: !!(clientId && clientSecret),
      clientId,
      hasSecret: !!clientSecret,
      redirectUri,
      redirectFromEnv: !!redirectFromEnv,
      tokenEncryption: !!(process.env.APP_SECRET || process.env.SECRETBOX_KEY),
      obsConfigured: !!process.env.OBS_WEBSOCKET_URL,
      obsUrl: process.env.OBS_WEBSOCKET_URL ?? null,
      accounts: accounts.map((a) => ({
        channelId: a.id,
        channelTitle: a.channelTitle ?? null,
        connectedAt: a.connectedAt ?? null,
        connectedBy: a.connectedBy ?? null,
        scopes: a.scopes ?? [],
      })),
    },
    { status: 200, headers: NO_CACHE },
  );
}

export const GET = withApiLog(GET__impl);
