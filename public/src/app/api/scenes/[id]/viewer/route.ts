import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppDb } from "@photonsurge/shared/db/index";
import { SESSION_COOKIE, readSession, isAdmin } from "@photonsurge/shared/utill/session";
import { MAIN_SCENE_ID } from "@photonsurge/shared/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/scenes/:id/viewer?token=… — the scene's viewer picks (music,
 * palette) for /watch's cold start; live changes arrive as `viewer:state`.
 * Authorised like the scene itself: the watch token, or an admin session.
 */
async function GET__impl(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getAppDb();
  const scene = id === MAIN_SCENE_ID ? await db.getOrInitBroadcastState() : await db.getScene(id);
  if (!scene) return NextResponse.json({ error: "no such scene" }, { status: 404, headers: NO_CACHE });

  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = sessionToken ? readSession(sessionToken) : null;
  const tokenParam = new URL(req.url).searchParams.get("token");
  const watchToken = (scene as { watchToken?: string }).watchToken;
  // The main scene's /watch is public (it is the main broadcast output).
  if (id !== MAIN_SCENE_ID && !isAdmin(session) && (!watchToken || tokenParam !== watchToken)) {
    return NextResponse.json({ error: "missing or invalid watch token" }, { status: 401, headers: NO_CACHE });
  }
  return NextResponse.json(await db.viewerState.get(id), { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
