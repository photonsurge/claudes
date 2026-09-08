import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../lib/require-admin";
import { withApiLog } from "../../../../lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

async function GET__impl() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "admin only" }, { status: 401, headers });
  try {
    const stats = await sendToQueueAndWait("stream", "youtube", "videoStats", {}, 25_000);
    return NextResponse.json({ stats }, { headers });
  } catch {
    return NextResponse.json({ error: "YouTube stats temporarily unavailable" }, { status: 503, headers });
  }
}

export const GET = withApiLog(GET__impl);
