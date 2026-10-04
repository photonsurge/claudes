import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { SHORTS_PREVIEW_SCENE_ID } from "@photonsurge/shared/short-scenes";
import { requireAdmin } from "../../../../lib/require-admin";
import { NO_CACHE, stopPreviewPlay } from "../preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/shorts/stop — stop the PREVIEW scene's play (director mode `off`;
 * the runner stamps it stopped within a tick). Only ever the preview scene.
 * → `{ ok, sceneId }`.
 */
async function POST__impl() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const db = await getAppDb();
  await stopPreviewPlay(db);
  return NextResponse.json({ ok: true, sceneId: SHORTS_PREVIEW_SCENE_ID }, { status: 200, headers: NO_CACHE });
}

export const POST = withApiLog(POST__impl);
