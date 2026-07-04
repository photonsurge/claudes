import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession, isAdmin } from "@photonsurge/shared/utill/session";

/**
 * Gates the admin/operator surface behind an admin session cookie. Proxy
 * (Next's renamed `middleware`) always runs on the Node.js runtime, so it can
 * reuse the same `jsonwebtoken`-based session verification as the API routes
 * — no separate Edge-safe JWT library needed.
 *
 * `/watch/**` is deliberately NOT gated here — it's the OBS/YouTube output and
 * can't do interactive login. It's protected separately by a per-scene
 * `?token=` check inside the scene/broadcast-state API routes.
 */
export const config = {
  matcher: ["/admin/:path*", "/control", "/api/admin/:path*", "/api/broadcast/state", "/api/scenes/:path*"],
};

const GET_LIKE = new Set(["GET", "HEAD"]);

function needsAdmin(pathname: string, method: string): boolean {
  if (pathname === "/control" || pathname.startsWith("/admin")) return true;
  if (pathname.startsWith("/api/admin")) return true;
  // /api/broadcast/state and /api/scenes/** allow anonymous GET (dual-auth via
  // watch token, checked inside the route); only mutations require admin here.
  if (pathname === "/api/broadcast/state") return !GET_LIKE.has(method);
  if (pathname.startsWith("/api/scenes")) return !GET_LIKE.has(method);
  return false;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!needsAdmin(pathname, req.method)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? readSession(token) : null;
  if (isAdmin(session)) return NextResponse.next();

  const isPage = pathname === "/control" || pathname.startsWith("/admin");
  if (isPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
