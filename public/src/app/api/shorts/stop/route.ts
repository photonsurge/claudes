import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sceneIdForScript } from "@photonsurge/shared/short-script";
import { DEFAULT_SHORT_FORMAT_ID } from "@photonsurge/shared/short-scenes";
import { requireAdmin } from "../../../../lib/require-admin";
import { NO_CACHE, stopPreviewPlay } from "../preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/shorts/stop { scriptId? | formatId? } — stop a format scene's play
 * (director mode `off`; the runner stamps it stopped within a tick): the
 * script's format scene (`sceneIdForScript`), else the named format's, else
 * the default format's. Only ever a format scene. 404 for an unknown script.
 * → `{ ok, sceneId }`.
 */
async function POST__impl(req?: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let body: { scriptId?: unknown; formatId?: unknown } = {};
  try {
    body = (req ? await req.json() : null) ?? {};
  } catch {
    /* no body = the default format */
  }
  const db = await getAppDb();
  let sceneId = typeof body.formatId === "string" && body.formatId.trim() ? body.formatId.trim() : DEFAULT_SHORT_FORMAT_ID;
  if (typeof body.scriptId === "string" && body.scriptId) {
    const script = await db.shortScripts.get(body.scriptId);
    if (!script) return NextResponse.json({ error: "no such script" }, { status: 404, headers: NO_CACHE });
    sceneId = sceneIdForScript(script);
  } else if (sceneId !== DEFAULT_SHORT_FORMAT_ID && !(await db.shortFormats.get(sceneId))) {
    // Only a format's scene, never an arbitrary channel's director.
    return NextResponse.json({ error: "no such format" }, { status: 404, headers: NO_CACHE });
  }
  await stopPreviewPlay(db, sceneId);
  return NextResponse.json({ ok: true, sceneId }, { status: 200, headers: NO_CACHE });
}

export const POST = withApiLog(POST__impl);
