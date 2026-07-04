import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@photonsurge/shared/utill/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout — clears the admin session cookie. */
export async function POST(req: Request) {
  const accept = req.headers.get("accept") ?? "";
  const wantsHtml = accept.includes("text/html");
  const res = wantsHtml
    ? NextResponse.redirect(new URL("/login", req.url))
    : NextResponse.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
