import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppDb } from "@photonsurge/shared/db/index";
import { SESSION_COOKIE, readSession, isAdmin } from "@photonsurge/shared/utill/session";
import { MAIN_SCENE_ID, sceneSurface } from "@photonsurge/shared/control";
import { emptyGame } from "@photonsurge/shared/crossword";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/crossword/:scene/state?token=... — the crossword scene's public
 * projection (the stored `pub`; answers never leave the worker). 404 unless the
 * scene exists and is a crossword channel. Gated like GET /api/scenes/:id: the
 * scene's watch token (OBS can't log in) or an admin session. A scene whose
 * game has not started yet gets the empty idle projection.
 *
 * `serverNow` is stamped at serve time, not taken from the stored copy: the
 * page corrects every countdown by it, and the stored one is as old as the
 * game's last change.
 */
async function GET__impl(req: Request, { params }: { params: Promise<{ scene: string }> }) {
  const { scene } = await params;
  const db = await getAppDb();
  const doc = scene === MAIN_SCENE_ID ? null : await db.getScene(scene);
  if (!doc || sceneSurface(doc) !== "crossword") {
    return NextResponse.json({ error: "no such crossword scene" }, { status: 404, headers: NO_CACHE });
  }

  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = sessionToken ? readSession(sessionToken) : null;
  const tokenParam = new URL(req.url).searchParams.get("token");
  const watchToken = (doc as { watchToken?: string }).watchToken;
  if (!isAdmin(session) && (!watchToken || tokenParam !== watchToken)) {
    return NextResponse.json({ error: "missing or invalid watch token" }, { status: 401, headers: NO_CACHE });
  }

  const now = Date.now();
  const pub = (await db.crosswordGames.getPublic(scene)) ?? emptyGame(scene, now).pub;
  return NextResponse.json({ ...pub, serverNow: now }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
