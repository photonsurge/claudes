import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { alertSlotAds } from "@photonsurge/shared/ads/alert-slot";
import { withCache, FEED_TTL_SEC } from "../../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/ads/alert-slot
 * The New alerts card's sponsor rotation list — every active
 * `alertSlot`-placed IMAGE creative, as the lean public wire shape (title /
 * advertiser / media URL only; the catalog's operator metadata never leaves
 * the admin), in the stable shared order. Public (the /watch surface reads
 * it), served from the shared feed cache like the billboard's list.
 */
async function GET__impl() {
  try {
    const { value, hit } = await withCache("feed:v2:ads:alertSlot", FEED_TTL_SEC, async () => {
      const db = await getAppDb();
      const active = await db.ads.list({ status: "active" });
      const ads = alertSlotAds(active);
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
