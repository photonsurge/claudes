import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** POST /api/youtube/disconnect { channelId } — forget a channel's stored token. */
async function POST__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let channelId = "";
  try {
    channelId = String(((await req.json()) ?? {}).channelId ?? "");
  } catch {
    /* validated below */
  }
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const ok = await db.deleteYoutubeAccount(channelId);
  return NextResponse.json({ ok, channelId }, { status: ok ? 200 : 404, headers: NO_CACHE });
}

export const POST = withApiLog(POST__impl);
