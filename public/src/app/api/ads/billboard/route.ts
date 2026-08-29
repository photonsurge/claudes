import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { billboardAds } from "@photonsurge/shared/ads/billboard";
import { withCache, FEED_TTL_SEC } from "../../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/ads/billboard
 * The bottom-left sponsor billboard's rotation list — every active
 * `billboard`-placed IMAGE creative, as the lean public wire shape (title /
 * advertiser / media URL only; the catalog's operator metadata never leaves
 * the admin). Order is the stable shared rotation order, so every /watch
 * output cycling by wall clock shows the same creative at the same moment.
 * Public (the /watch surface reads it), served from the shared feed cache
 * like the other broadcast reads.
 */
async function GET__impl() {
  try {
    const { value, hit } = await withCache("feed:v2:ads:billboard", FEED_TTL_SEC, async () => {
      const db = await getAppDb();
      const active = await db.ads.list({ status: "active" });
      const ads = billboardAds(active);
      return { count: ads.length, ads };
    });
    return NextResponse.json(value, {
      status: 200,
      headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), ads: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
