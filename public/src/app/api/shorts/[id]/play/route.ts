import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { SHORTS_PREVIEW_SCENE_ID } from "@photonsurge/shared/short-scenes";
import { requireAdmin } from "../../../../../lib/require-admin";
import { NO_CACHE, NO_PREVIEW_SCENE, startPreviewPlay } from "../../preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/shorts/:id/play { fromClip? } — preview a script on the PREVIEW
 * scene (never the render scene): mode `script`, a fresh nonce, `record: false`.
 * `fromClip` is clamped into the script's clip range. 409 when the preview
 * scene hasn't been seeded — a play there would render nowhere.
 * → `{ ok, sceneId, fromClip, playNonce }`.
 */
async function POST__impl(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  let body: { fromClip?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* no body = from the top */
  }

  const db = await getAppDb();
  const script = await db.shortScripts.get(id);
  if (!script) return NextResponse.json({ error: "no such script" }, { status: 404, headers: NO_CACHE });
  if (!script.clips.length) {
    return NextResponse.json({ error: "this script has no clips to play" }, { status: 400, headers: NO_CACHE });
  }
  if (!(await db.getScene(SHORTS_PREVIEW_SCENE_ID))) {
    return NextResponse.json({ error: NO_PREVIEW_SCENE }, { status: 409, headers: NO_CACHE });
  }

  const raw = typeof body.fromClip === "number" && Number.isFinite(body.fromClip) ? Math.floor(body.fromClip) : 0;
  const fromClip = Math.min(script.clips.length - 1, Math.max(0, raw));
  const playNonce = await startPreviewPlay(db, id, fromClip);
  return NextResponse.json(
    { ok: true, sceneId: SHORTS_PREVIEW_SCENE_ID, fromClip, playNonce },
    { status: 200, headers: NO_CACHE },
  );
}

export const POST = withApiLog(POST__impl);
