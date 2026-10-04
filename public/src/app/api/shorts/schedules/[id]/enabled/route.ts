import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../../../lib/require-admin";
import { NO_CACHE } from "../../../preview";
import { checkSchedule } from "../../check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/shorts/schedules/:id/enabled { enabled } — the schedule row's
 * switch (§8). On: `nextAt` is the next fire from now (a time already missed
 * is not caught up). Off: `nextAt` is cleared.
 *  • 200 the stored schedule · 400 not a boolean, or a once schedule whose time has passed · 404
 */
async function POST__impl(req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  let body: { enabled?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* falls through to validation */
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const existing = await db.shortSchedules.get(id);
  if (!existing) return NextResponse.json({ error: "no such schedule" }, { status: 404, headers: NO_CACHE });
  const checked = await checkSchedule(db, { enabled: body.enabled }, existing);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400, headers: NO_CACHE });
  const saved = await db.shortSchedules.save(checked.schedule);
  if (!saved) return NextResponse.json({ error: "no such schedule" }, { status: 404, headers: NO_CACHE });
  return NextResponse.json(saved, { status: 200, headers: NO_CACHE });
}

export const POST = withApiLog(POST__impl);
