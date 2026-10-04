import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../../lib/require-admin";
import { NO_CACHE } from "../../preview";
import { checkSchedule } from "../check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/shorts/schedules/:id — one schedule (404 if unknown). */
async function GET__impl(_req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  const schedule = await db.shortSchedules.get(id);
  if (!schedule) return NextResponse.json({ error: "no such schedule" }, { status: 404, headers: NO_CACHE });
  return NextResponse.json(schedule, { status: 200, headers: NO_CACHE });
}

/**
 * PUT /api/shorts/schedules/:id — edit a schedule. The body is sanitised ONTO
 * the stored schedule (a partial body is a patch; `videos`, when sent,
 * replaces the batch); the id is the URL's. Every edit recomputes `nextAt`
 * from now — a Mongo write the ticker reads, nothing touches BullMQ (§8).
 *  • 200 the stored schedule · 400 `{ error }` · 404 unknown
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
  const db = await getAppDb();
  const existing = await db.shortSchedules.get(id);
  if (!existing) return NextResponse.json({ error: "no such schedule" }, { status: 404, headers: NO_CACHE });
  const checked = await checkSchedule(db, body, existing);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400, headers: NO_CACHE });
  const saved = await db.shortSchedules.save(checked.schedule);
  if (!saved) return NextResponse.json({ error: "no such schedule" }, { status: 404, headers: NO_CACHE });
  return NextResponse.json(saved, { status: 200, headers: NO_CACHE });
}

/**
 * DELETE /api/shorts/schedules/:id — remove a schedule. Videos it already
 * queued stay in the render queue (cancel them there).
 */
async function DELETE__impl(_req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const db = await getAppDb();
  if (!(await db.shortSchedules.remove(id))) {
    return NextResponse.json({ error: "no such schedule" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json({ ok: true, id }, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
export const PUT = withApiLog(PUT__impl);
export const DELETE = withApiLog(DELETE__impl);
