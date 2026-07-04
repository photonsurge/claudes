import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { verifyPassword } from "@photonsurge/shared/utill/password";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@photonsurge/shared/utill/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** POST /api/auth/login { email, password } — sets the admin session cookie. */
export async function POST(req: Request) {
  let body: { email?: string; password?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body → invalid below */
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const fail = () =>
    NextResponse.json({ error: "Invalid email or password" }, { status: 401, headers: NO_CACHE });

  if (!email || !password) return fail();

  const db = await getAppDb();
  const user = await db.users.findByEmail(email);
  if (!user || !user.active) return fail();
  if (!(await verifyPassword(password, user.passwordHash))) return fail();

  const token = signSession({ sub: user.id, email: user.email, role: user.role });
  await db.users.touchLogin(user.id);

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
