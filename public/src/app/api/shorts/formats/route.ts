import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { duplicateFormat } from "@photonsurge/shared/db/short-format-copy";
import { DEFAULT_SHORT_FORMAT_ID } from "@photonsurge/shared/short-format";
import { requireAdmin } from "../../../../lib/require-admin";
import type { ShortFormatItem } from "../../../../lib/shorts";
import { NO_CACHE } from "../preview";
import { COPY_STATUS } from "./status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/shorts/formats — every short format (docs/short-video-plan.md §5),
 * the default first, each with how many scripts are made in it (the delete
 * guard's count). → `{ formats, defaultId }`.
 */
async function GET__impl() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const formats = await db.shortFormats.list();
  const rows: ShortFormatItem[] = await Promise.all(
    formats.map(async (f) => ({ ...f, scriptCount: await db.shortScripts.countByFormat(f.id) })),
  );
  rows.sort((a, b) => (a.id === DEFAULT_SHORT_FORMAT_ID ? -1 : b.id === DEFAULT_SHORT_FORMAT_ID ? 1 : 0));
  return NextResponse.json({ formats: rows, defaultId: DEFAULT_SHORT_FORMAT_ID }, { status: 200, headers: NO_CACHE });
}

/**
 * POST /api/shorts/formats { name, from } — make a format by DUPLICATING a
 * channel (`from` = its scene id) or another format (`from` = its id): a new
 * hidden short scene with the source's look and director config, and short
 * settings copied from a format or defaulted from a channel. No link back.
 *  • 201 `{ format }`
 *  • 400 no usable name · 404 no such source · 409 the id is taken
 */
async function POST__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let body: { name?: unknown; from?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* falls through to validation */
  }
  const name = typeof body.name === "string" ? body.name : "";
  const from = typeof body.from === "string" ? body.from.trim() : "";
  if (!from) {
    return NextResponse.json({ error: "from (a channel or format id) is required" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const res = await duplicateFormat(db, { name, from });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: COPY_STATUS[res.code], headers: NO_CACHE });
  return NextResponse.json({ format: res.format }, { status: 201, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
