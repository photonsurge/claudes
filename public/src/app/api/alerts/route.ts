import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { groupAlerts } from "../../../lib/alertGroups";
import { withCache, FEED_TTL_SEC } from "../../../lib/focus/focus-cache";
import { simplifyGeometry } from "@photonsurge/shared/geo/simplify";
import type { Alert } from "../../../lib/alerts";

/** Overlay polygons are drawn on a globe — a whole-ocean warning's 40k-vertex
 *  ring is a blob at that zoom. Simplifying to ~0.05° (~5 km) cuts vertices ~100×,
 *  shrinking the cached feed from hundreds of MB to a few, so every poll no longer
 *  re-parses a giant payload (the public OOM). Tune with ALERT_SIMPLIFY_DEG. */
const ALERT_SIMPLIFY_DEG = Number(process.env.ALERT_SIMPLIFY_DEG || 0.05);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/alerts — list alerts for the admin page / map overlay.
 * Query: ?active=1 (default all), ?source=nws, ?severityMin=2, ?limit=500,
 *        ?bbox=w,s,e,n (geo-intersect, polygon sources only).
 */
async function GET__impl(req: Request) {
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
  // Lean = drop the fields the map/world-watch overlay never reads (raw
  // description + per-area geocodes). Only the broadcast consumers pass it;
  // admin omits it so its detail view keeps the full untranslated text.
  const lean = q.get("lean") === "1";

  // Redis result-cache keyed by the full param set that determines the response —
  // so the overlay + world-watch DUPLICATE fetches, the 60s re-polls, and every
  // extra tab/OBS source collapse onto one sub-ms read instead of re-running the
  // (up-to-5000-row) Mongo query + O(n²) clustering each time. Fail-open.
  const key = `feed:v1:alerts:${activeOnly ? 1 : 0}:${source ?? "-"}:${severityMin ?? "-"}:${limit ?? "-"}:${
    bbox ? bbox.map((n) => n.toFixed(2)).join(",") : "-"
  }:${lean ? "lean1" : "-"}`;

  const { value, hit } = await withCache(key, FEED_TTL_SEC, async () => {
    const db = await getAppDb();
    const alerts = await db.alerts.list({ activeOnly, source, severityMin, limit, bbox, lean });

    // Shrink the payload BEFORE clustering + caching. Full geometry (whole-ocean
    // 40k-vertex rings) made this feed hundreds of MB; every poll then re-parsed
    // it into a fresh copy and, under continuous polling, those copies piled up
    // faster than GC could reclaim → public OOM. Simplify to a globe-coarse
    // tolerance once, here — the cached value (and every hit's parse of it) is
    // then tiny, and groupAlerts walks far fewer vertices too.
    for (const a of alerts) {
      for (const info of a.info ?? []) {
        for (const area of info.area ?? []) {
          if (area?.geometry) {
            area.geometry = simplifyGeometry(area.geometry, ALERT_SIMPLIFY_DEG);
          }
        }
      }
    }

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

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
