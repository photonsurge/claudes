import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** PATCH /api/admin/sea-points/[pointId] — toggle enabled (admin gate). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ pointId: string }> },
) {
  const { pointId } = await params;
  let body: { enabled?: unknown } = {};
  try {
    body = (await req.json()) as { enabled?: unknown };
  } catch {
    /* empty */
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400, headers: NO_CACHE });
  }

  const db = await getAppDb();
  const existing = await db.seaPoints.getByPointId(decodeURIComponent(pointId));
  if (!existing) {
    return NextResponse.json({ error: "sea point not found" }, { status: 404, headers: NO_CACHE });
  }
  const seaPoint = await db.seaPoints.upsertOne({ ...existing, enabled: body.enabled });
  return NextResponse.json({ seaPoint }, { status: 200, headers: NO_CACHE });
}

/** DELETE /api/admin/sea-points/[pointId]. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ pointId: string }> },
) {
  const { pointId } = await params;
  const db = await getAppDb();
  const removed = await db.seaPoints.remove(decodeURIComponent(pointId));
  if (!removed) {
    return NextResponse.json({ error: "sea point not found" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json({ ok: true, pointId }, { status: 200, headers: NO_CACHE });
}
