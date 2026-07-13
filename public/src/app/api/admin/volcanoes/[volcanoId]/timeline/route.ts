import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildEventTimeline } from "@photonsurge/shared/events/event-timeline";
import { normalizeVolcanoId } from "../../../../../../lib/volcano-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/volcanoes/:volcanoId/timeline — the official status timeline for
 * one volcano (the WatchedEvent it was promoted to + its stored beats, built with
 * the same `buildEventTimeline` the on-air slide uses). Backs the "Status
 * timeline" card in the /admin/volcanoes detail panel. `:volcanoId` is the
 * `gvp:<vnum>` key. Returns `{ event: null, timeline: [] }` when the volcano was
 * never promoted (not significant, or EVENTS_UNIFIED_ENABLED off) — the card
 * self-hides.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ volcanoId: string }> }) {
  const { volcanoId: raw } = await params;
  const volcanoId = normalizeVolcanoId(raw);
  const db = await getAppDb();
  const event = await db.watchedEvents.byPrimary("gvp", volcanoId);
  if (!event?.id) return NextResponse.json({ event: null, timeline: [] }, { status: 200, headers: NO_CACHE });
  const updates = await db.eventTimeline.listForEvent(event.id);
  const timeline = buildEventTimeline(event, updates);
  return NextResponse.json({ event, timeline }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
