import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { defaultShortSchedule } from "@photonsurge/shared/short-schedule";
import { requireAdmin } from "../../../../lib/require-admin";
import { NO_CACHE } from "../preview";
import { checkSchedule } from "./check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/shorts/schedules — every scheduled video batch (docs/short-video-plan.md
 * §8), by name, each with its next fire (`nextAt`) and last outcome
 * (`lastFire`, linking its batch). → `{ schedules }`.
 */
async function GET__impl() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const db = await getAppDb();
  return NextResponse.json({ schedules: await db.shortSchedules.list() }, { status: 200, headers: NO_CACHE });
}

/**
 * POST /api/shorts/schedules — create a schedule. The body is sanitised onto
 * the defaults (off, every day 07:00 London, any video encoder, 1 h start-by,
 * round-ups up to 14 h old refreshed); `fireCount`, `nextAt` and `lastFire`
 * are the server's. `nextAt` is computed from `when` when enabled.
 *  • 201 the stored schedule · 400 `{ error }` an invalid video, `when` or format
 */
async function POST__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const checked = await checkSchedule(db, body, defaultShortSchedule());
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400, headers: NO_CACHE });
  const { id: _id, ...input } = checked.schedule;
  const created = await db.shortSchedules.create(input);
  return NextResponse.json(created, { status: 201, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
