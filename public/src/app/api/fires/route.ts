import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/fires?bbox=w,s,e,n&minFrp=0&limit=0
 * Reads the worker-cached NASA FIRMS active-fire detections from Mongo — the
 * public app NEVER calls FIRMS directly. Returns EVERYTHING by default (no cap).
 * Configure the source/cadence on the worker (FIRMS_SOURCE, FIRE_SNAPSHOT_MS).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  let bbox: [number, number, number, number] | undefined;
  const bboxRaw = url.searchParams.get("bbox");
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      bbox = parts as [number, number, number, number];
    }
  }

  const minFrpRaw = Number(url.searchParams.get("minFrp"));
  const minFrp = Number.isFinite(minFrpRaw) && minFrpRaw > 0 ? minFrpRaw : undefined;

  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  try {
    const db = await getAppDb();
    const fires = await db.fires.list({ minFrp, bbox, limit });
    return NextResponse.json(
      { count: fires.length, fires },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err), fires: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
