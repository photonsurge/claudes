import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ id: string }> };

/** Player ids carry a colon (`youtube:…`, `sim:…`); accept it encoded or not. */
const decodeId = (raw: string) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/**
 * PATCH /api/crossword/players/:id { hidden } — hide or unhide a player. A
 * hidden player's answers are ignored by the runner and they drop off the
 * today and all-time boards; their solve log stays. 404 if unknown.
 */
async function PATCH__impl(req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const id = decodeId((await params).id);
  let body: { hidden?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    /* validated below */
  }
  if (typeof body.hidden !== "boolean") {
    return NextResponse.json({ error: "hidden must be true or false" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  if (!(await db.crosswordPlayers.setHidden(id, body.hidden))) {
    return NextResponse.json({ error: "no such player" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json({ ok: true, hidden: body.hidden }, { status: 200, headers: NO_CACHE });
}

export const PATCH = withApiLog(PATCH__impl);
