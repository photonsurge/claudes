import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/alerts/:id — one alert in full (including `raw`), its CAP
 * lifecycle chain (the messages it updates + the updates that follow it,
 * oldest-first), and its as-run history (every director cut that aired it).
 * Backs the /admin/alerts/:id detail page.
 *
 * `:id` is normally the doc uuid, but the composite "source:identifier" dedup
 * key also resolves — run-timeline links only know the storm segment's key.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getAppDb();
  let alert = await db.alerts.getById(id);
  if (!alert && id.includes(":")) {
    const [source, ...rest] = id.split(":");
    const found = await db.alerts.model
      .findOne({ source, identifier: rest.join(":") })
      .lean()
      .exec();
    if (found) alert = await db.alerts.getById(found.id);
  }
  if (!alert) {
    return NextResponse.json({ error: "no such alert" }, { status: 404, headers: NO_CACHE });
  }
  const [chain, aired] = await Promise.all([
    db.alerts.chain(alert.source, alert.identifier),
    // Storm segments are keyed "storm:<source>:<identifier>" (see worker candidates).
    db.airLog.listEntriesForSegment(`storm:${alert.source}:${alert.identifier}`),
  ]);
  return NextResponse.json({ alert, chain, aired }, { status: 200, headers: NO_CACHE });
}
