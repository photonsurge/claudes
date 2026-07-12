import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { CamStatus } from "@photonsurge/shared/cams/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const STATUSES: CamStatus[] = ["active", "inactive", "unknown"];

/** PATCH /api/admin/cams/[camId] — set status (admin toggle). */
async function PATCH__impl(
  req: Request,
  { params }: { params: Promise<{ camId: string }> },
) {
  const { camId } = await params;
  let body: { status?: unknown } = {};
  try {
    body = (await req.json()) as { status?: unknown };
  } catch {
    /* empty */
  }

  if (!STATUSES.includes(body.status as CamStatus)) {
    return NextResponse.json(
      { error: `status must be one of ${STATUSES.join(", ")}` },
      { status: 400, headers: NO_CACHE },
    );
  }

  const db = await getAppDb();
  const cam = await db.cams.setStatus(decodeURIComponent(camId), body.status as CamStatus);
  if (!cam) {
    return NextResponse.json({ error: "cam not found" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json({ cam }, { status: 200, headers: NO_CACHE });
}

/** DELETE /api/admin/cams/[camId]. */
async function DELETE__impl(
  _req: Request,
  { params }: { params: Promise<{ camId: string }> },
) {
  const { camId } = await params;
  const db = await getAppDb();
  const removed = await db.cams.remove(decodeURIComponent(camId));
  if (!removed) {
    return NextResponse.json({ error: "cam not found" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json({ ok: true, camId }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const PATCH = withApiLog(PATCH__impl);
export const DELETE = withApiLog(DELETE__impl);
