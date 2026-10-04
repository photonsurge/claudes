import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A shot's blob key as the worker writes it: `<runId>-<clipIndex>.jpg`. */
const SHOT_ID = /^[A-Za-z0-9_-]{1,80}-\d{1,4}\.jpg$/;

/**
 * GET /api/shorts/shots/[blobId] — one OBS screenshot of a video render's
 * offline test (docs/short-video-plan.md §7), from the `short-tests` blob
 * namespace. Admin only. A shot never changes once taken (its key carries the
 * run and clip), but a newer test of the script deletes it, so it is cached
 * privately and briefly. 404 once it has been replaced.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ blobId: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { blobId } = await params;
  const id = decodeURIComponent(blobId);
  if (!SHOT_ID.test(id)) {
    return NextResponse.json({ error: "not a shot id" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const db = await getAppDb();
  const data = await db.blobs.shortTest.get(id).catch(() => null);
  if (!data?.byteLength) {
    return NextResponse.json(
      { error: "shot not found (a newer test of the script replaces it)" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, max-age=300",
    },
  });
}

export const GET = withApiLog(GET__impl);
