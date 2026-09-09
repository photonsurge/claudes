import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { QUAKE_LIVE_WINDOW_HOURS, quakeLiveWindowSince } from "@photonsurge/shared/seismic";
import { withCache, FEED_TTL_SEC } from "../../../../lib/focus/focus-cache";
import type { Quake } from "../../../../lib/tracks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/tracks/seismic?bbox=w,s,e,n&minMag=2.5&limit=2000
 * Reads the worker-cached USGS earthquakes from Mongo — the public app NEVER
 * calls USGS directly. Events are point-in-time (not dead-reckoned), so the
 * client just polls this on a slow interval. Configure the feed/cadence on the
 * worker (USGS_FEED, SEISMIC_SNAPSHOT_MS).
 *
 * Clipped to the live window (QUAKE_LIVE_WINDOW_HOURS, 48h) — the collection
 * retains ~a month, which smears the plate boundaries into a solid band of
 * rings on air. Filtered HERE rather than on the client so the payload shrinks
 * too. The on-air event escapes the window via the focus bundle, which loads
 * the cut's subject quake and its neighbours with no age filter.
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);

  let bbox: [number, number, number, number] | undefined;
  const bboxRaw = url.searchParams.get("bbox");
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      bbox = parts as [number, number, number, number];
    }
  }

  const minMagRaw = Number(url.searchParams.get("minMag"));
  const minMag = Number.isFinite(minMagRaw) ? minMagRaw : undefined;

  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  try {
    // The window LENGTH keys the cache, never the computed `since` instant —
    // an absolute timestamp in the key would miss on every request. A cached
    // entry therefore ages up to FEED_TTL_SEC, so the effective window is
    // 48h–48h10m. Immaterial on air, and it keeps this the single shared entry
    // the globe overlay and World Watch both read.
    const key = `feed:v1:quakes:${minMag ?? "-"}:${limit ?? "-"}:${
      bbox ? bbox.map((n) => n.toFixed(2)).join(",") : "-"
    }:${QUAKE_LIVE_WINDOW_HOURS}h`;
    const { value, hit } = await withCache(key, FEED_TTL_SEC, async () => {
      const db = await getAppDb();
      const rows = await db.quakes.list({ minMag, bbox, limit, sinceMs: quakeLiveWindowSince() });
      const quakes: Quake[] = rows.map((r) => ({
        id: r.quakeId,
        mag: r.mag,
        place: r.place,
        time: new Date(r.time).getTime(),
        lng: r.lng,
        lat: r.lat,
        depthKm: r.depthKm,
        url: r.url,
        tsunami: r.tsunami || undefined,
      }));
      return { count: quakes.length, quakes };
    });
    return NextResponse.json(value, {
      status: 200,
      headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), quakes: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
