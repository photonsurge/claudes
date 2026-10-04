import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * PUT /api/admin/presenters/settings — body `{ enabled: boolean }`. The master
 * switch: off, the worker makes no speech call at all, tests included.
 */
async function PUT__impl(req: Request) {
  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "enabled (boolean) required" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const settings = await db.presenterSettings.save({ enabled: body.enabled });
  return NextResponse.json({ ok: true, settings }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const PUT = withApiLog(PUT__impl);
