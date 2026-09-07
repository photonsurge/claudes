import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@photonsurge/shared/utill/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout — clears the admin session cookie. */
async function POST__impl(req: Request) {
  const accept = req.headers.get("accept") ?? "";
  const wantsHtml = accept.includes("text/html");
  const res = wantsHtml
    ? // Relative Location (303 = "see other after POST"): an absolute URL built
      // from req.url leaks the container's 0.0.0.0 bind origin to the browser.
      new NextResponse(null, { status: 303, headers: { Location: "/login" } })
    : NextResponse.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

// --- request logging (lib/api-log) ---
export const POST = withApiLog(POST__impl);
