import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { groupAlerts } from "../../../lib/alertGroups";
import { withCache, FEED_TTL_SEC } from "../../../lib/focus/focus-cache";
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

  const activeOnly = q.get("active") === "1" || q.get("active") === "true";
  const source = q.get("source") || undefined;
  const severityMin = num("severityMin");
  const limit = num("limit");

  // Redis result-cache keyed by the full param set that determines the response —
  // so the overlay + world-watch DUPLICATE fetches, the 60s re-polls, and every
  // extra tab/OBS source collapse onto one sub-ms read instead of re-running the
  // (up-to-5000-row) Mongo query + O(n²) clustering each time. Fail-open.
  const key = `feed:v1:alerts:${activeOnly ? 1 : 0}:${source ?? "-"}:${severityMin ?? "-"}:${limit ?? "-"}:${
    bbox ? bbox.map((n) => n.toFixed(2)).join(",") : "-"
  }`;

  const { value, hit } = await withCache(key, FEED_TTL_SEC, async () => {
    const db = await getAppDb();
    const alerts = await db.alerts.list({ activeOnly, source, severityMin, limit, bbox });

    // Cross-source clustering (same hazard + overlapping footprint) runs HERE on
    // the server, not in the browser — it's O(n²) over geometry and would stutter
    // the UI. Tag every alert with its cluster id + the full set of reporting
    // sources; the client just buckets by groupId (O(n)). Cached with the list so
    // repeat polls skip this too.
    const list = alerts as unknown as Alert[];
    for (const g of groupAlerts(list)) {
      for (const m of g.members) {
        m.groupId = g.id;
        m.groupSources = g.sources;
      }
    }
    return { alerts: list, count: list.length };
  });

  return NextResponse.json(value, {
    status: 200,
    headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" },
  });
}
