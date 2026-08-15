import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { encoderKeyForRun, runIsActive } from "@photonsurge/shared/runs";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * DELETE /api/streams/encoders/:id — remove an encoder registration. Refused
 * while a run is publishing through it (stop the run first); the OBS instance
 * itself is untouched either way.
 */
async function DELETE__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const active = (await db.listRuns({ status: ["scheduled", "awaiting-ingest", "live", "ending"] })).find(
    (r) => !!r.platforms?.youtube && encoderKeyForRun(r) === id && runIsActive(r.status),
  );
  if (active) {
    return NextResponse.json(
      { error: `encoder is in use by an active run on scene "${active.sceneId}"`, runId: active.id },
      { status: 409, headers: NO_CACHE },
    );
  }
  const ok = await db.deleteStreamEncoder(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404, headers: NO_CACHE });
}

export const DELETE = withApiLog(DELETE__impl);
