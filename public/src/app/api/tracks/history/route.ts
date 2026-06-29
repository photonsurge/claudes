import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { TrackSnapshotKind } from "@photonsurge/shared/db/track-snapshot-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/tracks/history?at=<ISO>&kind=aircraft|ship&bbox=w,s,e,n
 * The snapshots of one replay frame (batchAt = `at`).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const atRaw = url.searchParams.get("at");
  const at = atRaw ? new Date(atRaw) : null;
  if (!at || Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "missing/invalid ?at" }, { status: 400, headers: NO_CACHE });
  }

  const kind = (url.searchParams.get("kind") as TrackSnapshotKind | null) ?? undefined;
  let bbox: [number, number, number, number] | undefined;
  const bboxRaw = url.searchParams.get("bbox");
  if (bboxRaw) {
    const p = bboxRaw.split(",").map(Number);
    if (p.length === 4 && p.every(Number.isFinite)) bbox = p as [number, number, number, number];
  }

  const db = await getAppDb();
  const snapshots = await db.trackSnapshots.atBatch(at, { kind, bbox });
  return NextResponse.json(
    { at: at.toISOString(), count: snapshots.length, snapshots },
    { status: 200, headers: NO_CACHE },
  );
}
