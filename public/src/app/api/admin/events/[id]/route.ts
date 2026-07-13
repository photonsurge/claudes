import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildEventTimeline } from "@photonsurge/shared/events/event-timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/events/:id — one WatchedEvent's full dossier: the derived
 * timeline, every contributing source + its revision history, external links
 * (with match method/score), harvested resources (with attribution/licence),
 * metric series and captured snapshot metadata. Backs /admin/events/:id.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getAppDb();
  const event = await db.watchedEvents.getById(id);
  if (!event) {
    return NextResponse.json({ error: "no such event" }, { status: 404, headers: NO_CACHE });
  }
  const [sources, sourceRevisions, links, resources, series, snapshots, updates, schedules] = await Promise.all([
    db.eventSources.listForEvent(id),
    db.eventSourceRevisions.listForEvent(id),
    db.eventLinks.listForEvent(id),
    db.eventResources.listForEvent(id),
    db.eventSeries.listForEvent(id),
    db.eventSnapshots.listForEvent(id),
    db.eventTimeline.listForEvent(id),
    db.eventWatch.listForEvent(id),
  ]);
  const timeline = buildEventTimeline(event, updates);
  return NextResponse.json(
    { event, timeline, sources, sourceRevisions, links, resources, series, snapshots, schedules },
    { status: 200, headers: NO_CACHE },
  );
}

export const GET = withApiLog(GET__impl);
