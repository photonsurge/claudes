import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/alerts — list alerts for the admin page / map overlay.
 * Query: ?active=1 (default all), ?source=nws, ?severityMin=2, ?limit=500,
 *        ?bbox=w,s,e,n (geo-intersect, polygon sources only).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;

  const num = (k: string): number | undefined => {
    const v = q.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  let bbox: [number, number, number, number] | undefined;
  const bboxRaw = q.get("bbox");
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      bbox = parts as [number, number, number, number];
    }
  }

  const db = await getAppDb();
  const alerts = await db.alerts.list({
    activeOnly: q.get("active") === "1" || q.get("active") === "true",
    source: q.get("source") || undefined,
    severityMin: num("severityMin"),
    limit: num("limit"),
    bbox,
  });

  return NextResponse.json({ alerts, count: alerts.length }, { status: 200, headers: NO_CACHE });
}
