import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { deleteFormat, saveFormat } from "@photonsurge/shared/db/short-format-copy";
import { sanitizeShortFormat } from "@photonsurge/shared/short-format";
import { sanitizeScope } from "@photonsurge/shared/short-script";
import { requireAdmin } from "../../../../../lib/require-admin";
import { NO_CACHE } from "../../preview";
import { DELETE_STATUS } from "../status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/shorts/formats/:id — one format's short settings (404 if unknown). */
async function GET__impl(_req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const format = await db.shortFormats.get(id);
  if (!format) return NextResponse.json({ error: "no such format" }, { status: 404, headers: NO_CACHE });
  return NextResponse.json(format, { status: 200, headers: NO_CACHE });
}

/**
 * PUT /api/shorts/formats/:id — save a format's short settings. The body is
 * sanitised ONTO the stored format, so a partial body is a patch and junk
 * keeps the stored value; the id is the URL's, never the body's. A new name
 * renames the format's scene too. → the saved format. Its look (scene and
 * director config) is saved through the scene APIs, not here.
 */
async function PUT__impl(req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400, headers: NO_CACHE });
  }
  // A several-places scope with no valid place would sanitise to "keep the
  // stored scope" — refuse it instead of saving something other than was asked.
  const scope = (body.template as { scope?: { type?: unknown } } | undefined)?.scope;
  if (scope?.type === "places" && !sanitizeScope(scope)) {
    return NextResponse.json({ error: "Several places: add at least one place" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const existing = await db.shortFormats.get(id);
  if (!existing) return NextResponse.json({ error: "no such format" }, { status: 404, headers: NO_CACHE });
  const next = sanitizeShortFormat({ ...body, id }, existing)!;
  const saved = await saveFormat(db, next);
  return NextResponse.json(saved, { status: 200, headers: NO_CACHE });
}

/**
 * DELETE /api/shorts/formats/:id — delete a format with its scene and director
 * config. 400 for the default format; 409 while scripts are made in it, saying
 * how many (`{ error, scripts }`); 404 when unknown.
 */
async function DELETE__impl(_req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const res = await deleteFormat(db, id);
  if (!res.ok) {
    const body = {
      error: res.error,
      ...(res.scripts != null ? { scripts: res.scripts } : {}),
      ...(res.renders != null ? { renders: res.renders } : {}),
      ...(res.schedules != null ? { schedules: res.schedules } : {}),
    };
    return NextResponse.json(body, { status: DELETE_STATUS[res.code], headers: NO_CACHE });
  }
  return NextResponse.json({ ok: true, id }, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
export const PUT = withApiLog(PUT__impl);
export const DELETE = withApiLog(DELETE__impl);
