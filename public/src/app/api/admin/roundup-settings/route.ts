import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { ROUNDUP_IDS, ROUNDUP_META, type RoundupId, type RoundupSettings } from "@photonsurge/shared/roundup-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/roundup-settings — which AI round-ups are on and at which
 * hours, plus when each GLOBAL round-up last ran. Place round-ups are per
 * place, so their last run is shown in that page's list instead. (Admin-gated
 * by proxy.ts's `/api/admin/*` matcher.)
 */
async function GET__impl() {
  const db = await getAppDb();
  const settings = await db.roundupSettings.get();

  const lastRun: Partial<Record<RoundupId, string | null>> = {};
  await Promise.all(
    ROUNDUP_IDS.map(async (id) => {
      const period = ROUNDUP_META[id].period;
      if (!period) return;
      const latest = await db.eventSummaries.latest(period);
      lastRun[id] = latest ? new Date(latest.generatedAt).toISOString() : null;
    }),
  );

  return NextResponse.json({ settings, lastRun }, { status: 200, headers: NO_CACHE });
}

/**
 * PUT /api/admin/roundup-settings — body `{ settings: Partial<RoundupSettings> }`.
 * The provided ids are overlaid on the STORED settings: the round-ups are
 * edited from two pages that each own a different subset of rows, and `save`
 * alone merges over the defaults, so a page's save would otherwise reset the
 * rows it never sent.
 */
async function PUT__impl(req: Request) {
  const body = (await req.json().catch(() => null)) as { settings?: unknown } | null;
  const provided = body?.settings;
  if (!provided || typeof provided !== "object" || Array.isArray(provided)) {
    return NextResponse.json({ ok: false, error: "settings object required" }, { status: 400, headers: NO_CACHE });
  }

  const overlay: Partial<RoundupSettings> = {};
  for (const id of ROUNDUP_IDS) {
    if (id in provided) overlay[id] = (provided as Record<string, never>)[id];
  }

  const db = await getAppDb();
  const settings = await db.roundupSettings.save({ ...(await db.roundupSettings.get()), ...overlay });
  return NextResponse.json({ ok: true, settings }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const PUT = withApiLog(PUT__impl);
