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
 * `?token=` check inside the scene/broadcast-state API routes. The home page `/`
 * is not gated either: it's the public front door (what's on air + the YouTube
 * links), and it shows its operator-launcher face only to an admin session it
 * reads itself (app/page.tsx). /control and /sandbox, the operator consoles,
 * ARE gated here.
 */
export const config = {
  matcher: [
    "/admin/:path*",
    "/control",
    "/sandbox",
    "/api/admin/:path*",
    "/api/broadcast/state",
    "/api/scenes/:path*",
    "/api/director/:path*",
  ],
};

const GET_LIKE = new Set(["GET", "HEAD"]);

function needsAdmin(pathname: string, method: string): boolean {
  if (pathname === "/control" || pathname === "/sandbox" || pathname.startsWith("/admin")) return true;
  if (pathname.startsWith("/api/admin")) return true;
  // /api/broadcast/state, /api/scenes/** and /api/director/** allow anonymous
  // GET (/watch — the OBS output — reads scene state and director config
  // without a session); only mutations require admin here.
  if (pathname === "/api/broadcast/state") return !GET_LIKE.has(method);
  if (pathname.startsWith("/api/scenes")) return !GET_LIKE.has(method);
  if (pathname.startsWith("/api/director")) return !GET_LIKE.has(method);
  return false;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!needsAdmin(pathname, req.method)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? readSession(token) : null;
  if (isAdmin(session)) return NextResponse.next();

  const isPage = pathname === "/control" || pathname === "/sandbox" || pathname.startsWith("/admin");
  if (isPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
