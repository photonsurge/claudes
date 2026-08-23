/**
 * The app's external origin, for building self-referential redirect URLs.
 *
 * Behind the production reverse proxy the container binds to 0.0.0.0 and Next's
 * `req.url` resolves to that internal host (the same "HOSTNAME bind" trap that made
 * the health check read 0.0.0.0:10100) — so a redirect built from `req.url` sends the
 * browser to an unreachable `https://0.0.0.0:10100/...`. The OAuth redirect URI is the
 * one external origin we're certain of (Google validates it exactly), so derive the
 * public origin from it; fall back to the request origin — with a 0.0.0.0 → localhost
 * guard for an un-pinned dev box — only when it isn't set.
 */
export function publicOrigin(req: Request): string {
  const pinned = process.env.GOOGLE_OAUTH_REDIRECT_URI || process.env.YOUTUBE_REDIRECT_URI;
  if (pinned) {
    try {
      return new URL(pinned).origin;
    } catch {
      /* malformed env — fall through to the request origin */
    }
  }
  const u = new URL(req.url);
  if (u.hostname === "0.0.0.0") u.hostname = "localhost";
  return u.origin;
}
