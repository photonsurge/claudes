import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { groupAlerts } from "../../../lib/alertGroups";
import type { Alert } from "../../../lib/alerts";

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

  // Cross-source clustering (same hazard + overlapping footprint) runs HERE on
  // the server, not in the browser — it's O(n²) over geometry and would stutter
  // the UI. Tag every alert with its cluster id + the full set of reporting
  // sources; the client just buckets by groupId (O(n)).
  const list = alerts as unknown as Alert[];
  for (const g of groupAlerts(list)) {
    for (const m of g.members) {
      m.groupId = g.id;
      m.groupSources = g.sources;
    }
  }

  return NextResponse.json({ alerts: list, count: list.length }, { status: 200, headers: NO_CACHE });
}
