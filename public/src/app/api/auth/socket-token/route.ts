import { NextResponse } from "next/server";
import { generateShortLivedJwt } from "@photonsurge/shared/utill/jwt";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived JWT the browser uses to authenticate its socket
 * connection (actorType "user"). Signed with SOCKET_TOKEN_SECRET — the same
 * secret the socket server validates user tokens against.
 *
 * In a real app you'd derive `sub` from the authenticated session; here it's a
 * generated guest id so the demo works with no auth system.
 */
export async function GET() {
  const secret = process.env.SOCKET_TOKEN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SOCKET_TOKEN_SECRET not set" }, { status: 500 });
  }

  const sub = `guest-${Math.random().toString(36).slice(2, 10)}`;
  const token = generateShortLivedJwt({ sub, actorType: "user" }, "1h", secret);

  return NextResponse.json({
    token,
    socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000",
  });
}
