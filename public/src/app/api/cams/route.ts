import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { withCache, FEED_TTL_SEC } from "../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** Search radius around the on-air point, km — EventNearbyPanel's CAM_RADIUS_KM. */
export const DEFAULT_MAX_KM = 400;
export const MAX_MAX_KM = 5000;
/**
 * Cams per point. The panel airs three and says how many more are in range, so
 * this only has to be high enough to keep that count honest outside the very
 * densest catalog corners (London, the Alps).
 */
export const DEFAULT_LIMIT = 60;
export const MAX_LIMIT = 500;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * GET /api/cams?lng=<>&lat=<>[&maxKm=400][&limit=60]
 * The active webcams nearest a point — the on-air event — nearest first, from
 * the worker-cached catalog (the public app never calls the upstream
 * providers). This is the broadcast overlay's read: the "near this event"
 * panel wants the few cams within a few hundred km of the cut, nothing else.
 *
 * GET /api/cams — the whole active catalog, for tooling. It used to be the
 * broadcast's read as well, and it is the entire Windy catalog: 68 MB of JSON,
 * streamed for ten seconds by every /watch browser source on every page load,
 * then parsed on the main thread in one ~450 ms freeze (a native JSON parse
 * plus the full GC that 68 MB of fresh strings triggers) — the largest stall
 * left in the OBS profile (docs/watch-perf-plan.md, round 46). The client then
 * scanned all of it, every render, for the three cams within 400 km.
 */
async function GET__impl(req: Request) {
  const sp = new URL(req.url).searchParams;
  const hasPoint = sp.has("lng") || sp.has("lat");
  try {
    if (hasPoint) {
      // `Number(null)` is 0, so an ABSENT coordinate has to be NaN by hand —
      // "?lng=-0.1" alone must not become a search around the equator.
      const lng = sp.get("lng") === null ? Number.NaN : Number(sp.get("lng"));
      const lat = sp.get("lat") === null ? Number.NaN : Number(sp.get("lat"));
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return NextResponse.json(
          { error: "lng/lat must be finite coordinates", cams: [], count: 0 },
          { status: 400, headers: NO_CACHE },
        );
      }
      const maxKm = clamp(Number(sp.get("maxKm")) || DEFAULT_MAX_KM, 1, MAX_MAX_KM);
      const limit = clamp(Math.floor(Number(sp.get("limit")) || DEFAULT_LIMIT), 1, MAX_LIMIT);
      // Keyed on the point to ~1 km: every browser source cuts to the same
      // segment centre, so four sources share one Mongo read.
      const key = `feed:v1:cams:${lng.toFixed(2)},${lat.toFixed(2)}:${maxKm}:${limit}`;
      const { value, hit } = await withCache(key, FEED_TTL_SEC, async () => {
        const db = await getAppDb();
        const near = await db.cams.nearMany({ lng, lat, maxKm, limit, status: "active" });
        return { cams: near.map((n) => n.cam), count: near.length, center: [lng, lat], maxKm };
      });
      return NextResponse.json(value, { status: 200, headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" } });
    }
    const db = await getAppDb();
    const cams = await db.cams.list({ status: "active" });
    return NextResponse.json({ cams, count: cams.length }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err), cams: [], count: 0 }, { status: 502, headers: NO_CACHE });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
