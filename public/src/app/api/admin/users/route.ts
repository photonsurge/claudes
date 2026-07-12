import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { ALLOWED_ROLES } from "@photonsurge/shared/db/user-model";
import { hashPassword } from "@photonsurge/shared/utill/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** GET /api/admin/users — every admin account (never includes passwordHash). */
async function GET__impl() {
  const db = await getAppDb();
  const users = await db.users.list();
  return NextResponse.json({ users }, { status: 200, headers: NO_CACHE });
}

/**
 * POST /api/admin/users { email, password, role? } — create an admin account.
 * `role` defaults to "admin" and must be one of ALLOWED_ROLES.
 */
async function POST__impl(req: Request) {
  let body: { email?: string; password?: string; role?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_CACHE });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = body.role ? String(body.role) : "admin";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "a valid email is required" }, { status: 400, headers: NO_CACHE });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400, headers: NO_CACHE },
    );
  }
  if (!ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: `role must be one of: ${ALLOWED_ROLES.join(", ")}` }, { status: 400, headers: NO_CACHE });
  }

  const db = await getAppDb();
  if (await db.users.findByEmail(email)) {
    return NextResponse.json({ error: "a user with that email already exists" }, { status: 409, headers: NO_CACHE });
  }

  const passwordHash = await hashPassword(password);
  const created = await db.users.create({ email, passwordHash, role });
  const { passwordHash: _drop, ...safe } = created;
  return NextResponse.json({ user: safe }, { status: 201, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
