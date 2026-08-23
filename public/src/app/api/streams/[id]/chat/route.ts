import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/streams/:id/chat — the logged chat history for a run (live or
 * finished), written by the worker's chat poller. Backs the operator panel's
 * cold-start seed and the /admin/streams per-run chat view. Admin-only like the
 * rest of the streams surface; the live tail rides the socket, this is history.
 * `?since=<epoch ms>` returns only newer messages; no default cap.
 */
async function GET__impl(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  const since = Number(new URL(req.url).searchParams.get("since") || 0);
  const db = await getAppDb();
  const messages = await db.chatLog.listForRun(id, { since: since > 0 ? since : undefined });
  return NextResponse.json({ messages }, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
