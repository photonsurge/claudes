import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { verifyPassword } from "@photonsurge/shared/utill/password";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@photonsurge/shared/utill/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const DEBUG =true;
const dlog = (...args: unknown[]) => {
  if (DEBUG) console.log("[login]", ...args);
};

/** POST /api/auth/login { email, password } — sets the admin session cookie. */
async function POST__impl(req: Request) {
  console.log("[login] POST", { url: req.url, method: req.method, headers: req.headers });
  let body: { email?: string; password?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    dlog("invalid JSON body");
    /* empty body → invalid below */
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const fail = (reason: string) => {
    dlog("rejected:", reason, { email });
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401, headers: NO_CACHE });
  };

  if (!email || !password) return fail("missing email or password");

  const db = await getAppDb();
  const user = await db.users.findByEmail(email);
  dlog("lookup", { email, found: !!user, active: user?.active, role: user?.role });
  if (!user || !user.active) return fail("no such user or inactive");
  const passwordOk = await verifyPassword(password, user.passwordHash);
  dlog("password check", { email, passwordOk });
  if (!passwordOk) return fail("wrong password");

  const token = signSession({ sub: user.id, email: user.email, role: user.role });
  await db.users.touchLogin(user.id);
  dlog("login ok", { email, userId: user.id, role: user.role });

  const res = NextResponse.json({ ok: true }, { status: 200, headers: NO_CACHE });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}

// --- request logging (lib/api-log) ---
export const POST = withApiLog(POST__impl);
