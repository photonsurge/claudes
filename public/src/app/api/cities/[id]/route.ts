import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { validateCity } from "../../../../lib/cities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** GET /api/cities/[id] — one complete city record, including enrichment. */
async function GET__impl(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const db = await getAppDb();
    const result = await db.cities.getByID(decodeURIComponent(id));
    if (!result?.success || !result.data) {
      return NextResponse.json({ error: "city not found" }, { status: 404, headers: NO_CACHE });
    }
    return NextResponse.json({ city: result.data }, { status: 200, headers: NO_CACHE });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502, headers: NO_CACHE });
  }
}

/** PATCH /api/cities/[id] — update a city (validated). */
async function PATCH__impl(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }

  const result = validateCity(body as Record<string, unknown>);
  if (!result.ok || !result.value) {
    return NextResponse.json({ errors: result.errors }, { status: 400 });
  }

  const db = await getAppDb();
  const updated = await db.cities.updateByID(id, result.value);
  if (!updated?.success || !updated.data) {
    return NextResponse.json(
      { error: "update failed", errors: updated?.errors },
      { status: updated?.data === undefined ? 404 : 500 },
    );
  }
  return NextResponse.json({ city: updated.data }, { status: 200, headers: NO_CACHE });
}

/** DELETE /api/cities/[id]. */
async function DELETE__impl(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getAppDb();
  const res = await db.cities.deleteByID(id);
  if (!res?.success) {
    return NextResponse.json({ error: "delete failed" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const PATCH = withApiLog(PATCH__impl);
export const DELETE = withApiLog(DELETE__impl);
