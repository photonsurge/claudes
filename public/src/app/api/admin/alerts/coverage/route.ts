/**
 * /api/admin/alerts/coverage — the drawable-geometry health of active alerts, for
 * the /admin/alerts summary strip. Answers "how many alerts / areas can't draw?"
 *
 * Reads straight from Mongo via the shared alerts repo (`geometryCoverage()` — a
 * projected `{active:true}` scan of just `info.area.geometry.type`, so it's a
 * light read, not the worker's job). Cached briefly since the whole page and any
 * concurrent operators would otherwise each re-scan.
 */
import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { withCache } from "../../../../../lib/focus/focus-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_SEC = Number(process.env.ALERTS_COVERAGE_TTL_SEC || 30);

async function GET__impl(_req: Request) {
  const { value } = await withCache("alerts:coverage:v1", TTL_SEC, async () => {
    const db = await getAppDb();
    const c = await db.alerts.geometryCoverage();
    const drawableAlerts = c.alerts - c.alertsNoShape;
    const areasDrawn = c.areas - c.areasNoGeom;
    return {
      ...c,
      // Derived, so the UI doesn't recompute: fully/partly drawable counts + pcts.
      drawableAlerts,
      areasDrawn,
      areasDrawnPct: c.areas ? +(((areasDrawn) / c.areas) * 100).toFixed(1) : 0,
      alertsDrawnPct: c.alerts ? +((drawableAlerts / c.alerts) * 100).toFixed(1) : 0,
    };
  });
  return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
