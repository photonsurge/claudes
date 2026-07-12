import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateShortLivedJwt } from "@photonsurge/shared/utill/jwt";
import { SESSION_COOKIE, readSession, isAdmin } from "@photonsurge/shared/utill/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints a short-lived JWT the browser uses to authenticate its socket
 * connection (actorType "user"). Signed with SOCKET_TOKEN_SECRET — the same
 * secret the socket server validates user tokens against.
 *
 * Every page (including anonymous /watch, via the root SocketProvider) calls
 * this on mount, so it can't require a session — instead it upgrades the
 * token when one is present: an admin session cookie yields a `role: "admin"`
 * claim, which is what socket/src/handlers/relay.ts checks before allowing a
 * client to emit control:state. Anonymous callers still get a receive-only
 * guest token, same as before.
 */
async function GET__impl() {
  const secret = process.env.SOCKET_TOKEN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SOCKET_TOKEN_SECRET not set" }, { status: 500 });
  }

  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = sessionToken ? readSession(sessionToken) : null;

  const payload = isAdmin(session)
    ? { sub: session!.sub, role: "admin", actorType: "user" }
    : { sub: `guest-${Math.random().toString(36).slice(2, 10)}`, actorType: "user" };

  const token = generateShortLivedJwt(payload, "1h", secret);

  return NextResponse.json({
    token,
    socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000",
  });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
