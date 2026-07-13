import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildEventTimeline } from "@photonsurge/shared/events/event-timeline";
import { normalizeVolcanoId } from "../../../../../lib/volcano-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/volcanoes/:volcanoId — the full dossier for one volcano: its
 * cached doc (GVP + USGS + Wikipedia enrichment) plus the promoted WatchedEvent
 * and its official status timeline. Backs the /admin/volcanoes/:volcanoId detail
 * page. `:volcanoId` is the `gvp:<vnum>` key. `event`/`timeline` are null/[] when
 * the volcano was never promoted (not significant / EVENTS_UNIFIED_ENABLED off).
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ volcanoId: string }> }) {
  const { volcanoId: raw } = await params;
  const volcanoId = normalizeVolcanoId(raw);
  const db = await getAppDb();
  const volcano = await db.volcanoes.get(volcanoId);
  if (!volcano) return NextResponse.json({ error: "no such volcano" }, { status: 404, headers: NO_CACHE });
  const [event, cams] = await Promise.all([
    db.watchedEvents.byPrimary("gvp", volcanoId),
    db.cams.listForVolcano(volcanoId),
  ]);
  const timeline = event?.id ? buildEventTimeline(event, await db.eventTimeline.listForEvent(event.id)) : [];
  return NextResponse.json({ volcano, event: event ?? null, timeline, cams }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
