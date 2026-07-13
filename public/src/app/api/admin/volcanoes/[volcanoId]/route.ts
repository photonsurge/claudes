import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { buildEventTimeline } from "@photonsurge/shared/events/event-timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * URL-safe volcano id: routes carry the bare VOTW number (`264180`) to keep the
 * `gvp:` colon out of the path (a `%3A`-encoded colon mis-round-trips through the
 * route param). Reconstruct `gvp:<vnum>`; also tolerate a full/encoded id so old
 * links still resolve.
 */
export function normalizeVolcanoId(raw: string): string {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* raw wasn't percent-encoded — use as-is */
  }
  return s.startsWith("gvp:") ? s : `gvp:${s}`;
}

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
  const event = await db.watchedEvents.byPrimary("gvp", volcanoId);
  const timeline = event?.id ? buildEventTimeline(event, await db.eventTimeline.listForEvent(event.id)) : [];
  return NextResponse.json({ volcano, event: event ?? null, timeline }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
