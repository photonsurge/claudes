import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sceneIdForScript } from "@photonsurge/shared/short-script";
import { requireAdmin } from "../../../../../lib/require-admin";
import { NO_CACHE, noFormatScene, startPreviewPlay } from "../../preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/shorts/:id/play { fromClip? } — preview a script on its FORMAT's
 * scene (`sceneIdForScript`; the same scene a render uses, so the preview is
 * what renders): mode `script`, a fresh nonce, `record: false`. A play already
 * running there is replaced — one play per format at a time. `fromClip` is
 * clamped into the script's clip range. 409 when the format's scene doesn't
 * exist — a play there would render nowhere.
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
  const sceneId = sceneIdForScript(script);
  if (!(await db.getScene(sceneId))) {
    return NextResponse.json({ error: noFormatScene(sceneId) }, { status: 409, headers: NO_CACHE });
  }

  const raw = typeof body.fromClip === "number" && Number.isFinite(body.fromClip) ? Math.floor(body.fromClip) : 0;
  const fromClip = Math.min(script.clips.length - 1, Math.max(0, raw));
  const playNonce = await startPreviewPlay(db, sceneId, id, fromClip);
  return NextResponse.json(
    { ok: true, sceneId, fromClip, playNonce },
    { status: 200, headers: NO_CACHE },
  );
}

export const POST = withApiLog(POST__impl);
