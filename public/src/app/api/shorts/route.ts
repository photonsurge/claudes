import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { playFor, sceneIdForScript, scriptDurationMs } from "@photonsurge/shared/short-script";
import { requireAdmin } from "../../../lib/require-admin";
import type { ShortListItem } from "../../../lib/shorts";
import { NO_CACHE, formatRows } from "./preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/shorts — the /admin/shorts snapshot: every saved short script,
 * newest first, as a light row (no clips; the play on its format's scene
 * without its per-clip schedule), plus every format with its scene's
 * existence, watch token and director state. Polled by the page while a
 * preview plays.
 */
async function GET__impl() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const [scripts, stamps, formats] = await Promise.all([
    db.shortScripts.list(),
    // The repo's wire shape drops timestamps; the list shows when each was made.
    db.shortScripts.model.find({}, { id: 1, created: 1, _id: 0 }).lean().exec(),
    formatRows(db),
  ]);
  const createdById = new Map(
    (stamps as { id: string; created?: Date }[]).map((s) => [s.id, s.created ? new Date(s.created).toISOString() : undefined]),
  );

  const rows: ShortListItem[] = scripts.map((s) => {
    const play = playFor(s, sceneIdForScript(s));
    const row: ShortListItem = {
      id: s.id,
      formatId: sceneIdForScript(s),
      title: s.title,
      scope: s.scope,
      status: s.status,
      clipCount: s.clips.length,
      durationMs: scriptDurationMs(s.clips),
      created: createdById.get(s.id),
    };
    if (play) {
      const { clips: _clips, ...rest } = play;
      row.previewPlay = rest;
    }
    return row;
  });
  return NextResponse.json({ scripts: rows, formats }, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
