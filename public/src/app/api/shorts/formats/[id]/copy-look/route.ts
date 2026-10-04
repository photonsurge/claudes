import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { copyLookFrom } from "@photonsurge/shared/db/short-format-copy";
import { requireAdmin } from "../../../../../../lib/require-admin";
import { NO_CACHE } from "../../../preview";
import { COPY_STATUS } from "../../status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/shorts/formats/:id/copy-look { from } — "Copy look from…" (§5.1):
 * re-copy a channel's or another format's look and director config onto this
 * format's scene. Keeps the format's short settings and its scene's id, name,
 * kind and watch token. The UI confirms first; this just does it.
 * → `{ format }`; 404 unknown format or source; 400 copying from itself.
 */
async function POST__impl(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  let body: { from?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* falls through to validation */
  }
  const from = typeof body.from === "string" ? body.from.trim() : "";
  if (!from) {
    return NextResponse.json({ error: "from (a channel or format id) is required" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const res = await copyLookFrom(db, id, from);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: COPY_STATUS[res.code], headers: NO_CACHE });
  return NextResponse.json({ format: res.format }, { status: 200, headers: NO_CACHE });
}

export const POST = withApiLog(POST__impl);
