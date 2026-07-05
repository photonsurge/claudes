import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * POST /api/scenes/:id/rotate-token — issue a new watch token for a scene,
 * invalidating any previously-copied /watch URL. Admin-only (enforced by
 * proxy.ts's /api/scenes/:path* matcher, since POST isn't GET-like).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getAppDb();
  const watchToken = await db.rotateSceneToken(id);
  if (!watchToken) {
    return NextResponse.json({ error: "no such scene" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json({ watchToken }, { status: 200, headers: NO_CACHE });
}
