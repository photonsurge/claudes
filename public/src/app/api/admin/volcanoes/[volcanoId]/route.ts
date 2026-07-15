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
  const [event, cams, media, volcanoCameras, mediaSources] = await Promise.all([
    db.watchedEvents.byPrimary("gvp", volcanoId),
    db.cams.listForVolcano(volcanoId),
    db.volcanoMedia.listForVolcano(volcanoId),
    db.volcanoCameras.listForVolcano(volcanoId),
    db.volcanoMediaSources.list(),
  ]);
  const [timeline, snapshots, eruptions] = await Promise.all([
    event?.id ? db.eventTimeline.listForEvent(event.id).then((u) => buildEventTimeline(event, u)) : Promise.resolve([]),
    event?.id ? db.eventSnapshots.listForEvent(event.id) : Promise.resolve([]),
    // Eruption history is a CATALOG fact — present for EVERY volcano, promoted or
    // not, dormant or not (unlike the timeline/snapshots, which need an event).
    // Empty until `volcanoCatalog.seedEruptions` has run.
    db.volcanoEruptions.listForVolcano(volcanoId),
  ]);
  return NextResponse.json({ volcano, event: event ?? null, timeline, cams, snapshots, media, volcanoCameras, mediaSources, eruptions }, { status: 200, headers: NO_CACHE });
}

/**
 * PATCH /api/admin/volcanoes/:volcanoId — set (or clear, with "") the operator's
 * Wikipedia `searchOverride` for this volcano. The write also clears
 * `wikiFetchedAt`, so the next `volcanoes.enrichWiki` pass re-queries with the
 * new term; nothing is fetched here (all enrichment work is the worker's).
 */
async function PATCH__impl(req: Request, { params }: { params: Promise<{ volcanoId: string }> }) {
  const { volcanoId: raw } = await params;
  const volcanoId = normalizeVolcanoId(raw);
  let body: { searchOverride?: unknown } = {};
  try {
    body = (await req.json()) as { searchOverride?: unknown };
  } catch {
    /* empty */
  }
  if (body.searchOverride !== undefined && typeof body.searchOverride !== "string") {
    return NextResponse.json({ error: "searchOverride must be a string" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const found = await db.volcanoes.setSearchOverride(volcanoId, body.searchOverride as string | undefined);
  if (!found) return NextResponse.json({ error: "no such volcano" }, { status: 404, headers: NO_CACHE });
  return NextResponse.json({ volcano: await db.volcanoes.get(volcanoId) }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const PATCH = withApiLog(PATCH__impl);
