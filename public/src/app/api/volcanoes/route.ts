import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { withCache, FEED_TTL_SEC } from "../../../lib/focus/focus-cache";
import type { VolcanoStatus } from "@photonsurge/shared/volcanoes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/volcanoes?status=erupting&limit=0
 * Reads the worker-cached Smithsonian/USGS Weekly Volcanic Activity Report
 * from Mongo — the public app NEVER calls the feed directly. Returns
 * EVERYTHING by default (no cap). Configure the cadence on the worker
 * (VOLCANO_SNAPSHOT_MS).
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);

  const statusRaw = url.searchParams.get("status");
  const status: VolcanoStatus | undefined =
    statusRaw === "erupting" || statusRaw === "unrest" || statusRaw === "dormant" ? statusRaw : undefined;

  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  try {
    const key = `feed:v1:volcanoes:${status ?? "-"}:${limit ?? "-"}`;
    const { value, hit } = await withCache(key, FEED_TTL_SEC, async () => {
      const db = await getAppDb();
      const volcanoes = await db.volcanoes.list({ status, limit });
      return { count: volcanoes.length, volcanoes };
    });
    return NextResponse.json(value, {
      status: 200,
      headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), volcanoes: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
