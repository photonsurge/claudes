import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sponsorNames } from "@photonsurge/shared/ads/normalise";
import { withCache, FEED_TTL_SEC } from "../../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/ads/sponsors
 * The active sponsors' display names for the on-air "Sponsored by …" ticker
 * mentions — only ads placed on the `ticker` surface (an ad-break creative
 * stays off the crawl unless the operator opts it in), one entry per
 * advertiser however many creatives they run, no media, no metadata. Public
 * (the /watch surface reads it), served from the shared feed cache like the
 * other broadcast reads.
 */
async function GET__impl() {
  try {
    const { value, hit } = await withCache("feed:v2:ads:sponsors", FEED_TTL_SEC, async () => {
      const db = await getAppDb();
      const active = await db.ads.list({ status: "active" });
      const sponsors = sponsorNames(active.filter((a) => a.placements.includes("ticker")));
      return { count: sponsors.length, sponsors };
    });
    return NextResponse.json(value, {
      status: 200,
      headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), sponsors: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
