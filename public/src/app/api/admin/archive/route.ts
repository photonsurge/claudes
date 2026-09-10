import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const DAY = 86_400_000;

/**
 * GET /api/admin/archive?date=YYYY-MM-DD — one UTC day of the permanent record.
 *
 * Retention now keeps a deliberate DAILY SAMPLE rather than everything forever
 * (docs/blob-retention-plan.md): one weather frame per model and variable per
 * day, one alert still per alert per day, and every significant earthquake. This
 * route is what makes that sample legible — "what did the maps look like, what
 * was warned about, what shook" for a given day.
 *
 * Every read is metadata-only. Frame images are referenced by URL through the
 * existing history texture route, never inlined.
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400, headers: NO_CACHE });
  }
  const from = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(+from)) {
    return NextResponse.json({ error: "unparseable date" }, { status: 400, headers: NO_CACHE });
  }
  const to = new Date(+from + DAY - 1);

  const db = await getAppDb();

  // --- weather: the day's surviving frame keepers, grouped by variable --------
  const variables = await db.weatherFrames.variables();
  const perVariable = await Promise.all(
    variables.map(async (variable) => {
      const metas = await db.weatherFrames.listMeta({ variable, from, to });
      return {
        variable,
        frames: metas.map((m: any) => ({
          id: m.id,
          model: m.model,
          validTime: new Date(m.validTime).toISOString(),
          fhr: m.fhr,
          url: `/api/weather/history/tex/${m.id}.png`,
        })),
      };
    }),
  );
  const maps = perVariable.filter((v) => v.frames.length > 0);

  // --- alerts: what was in force that day ------------------------------------
  // An alert counts for the day when its life OVERLAPS it, not when it was first
  // sent — a three-day warning belongs to all three days it covered. `sent` and
  // `expiresAt` are stored as ISO strings, and the rest of the codebase compares
  // them as strings (see alerts-repo#deactivateExpired), so this does the same.
  //
  // `sent` is bounded on BOTH sides on purpose. Alerts are never deleted, so an
  // open-ended `sent <= dayEnd` walks every alert ever ingested and then sorts
  // them in memory — past a few hundred thousand documents that exceeds Mongo's
  // 32MB sort limit and errors outright. The lower bound turns it into an index
  // range on `alert_sent_sev_ix`. The cost is a stated assumption: a warning
  // issued more than ALERT_MAX_LEAD_DAYS before the day it covers is missed.
  const leadDays = Number(process.env.ALERT_MAX_LEAD_DAYS || 14);
  const fromIso = new Date(+from - leadDays * DAY).toISOString();
  const dayStartIso = from.toISOString();
  const toIso = to.toISOString();
  const alertDocs = await db.alerts.model
    .find(
      {
        sent: { $gte: fromIso, $lte: toIso },
        $or: [{ expiresAt: { $gte: dayStartIso } }, { expiresAt: null }, { expiresAt: { $exists: false } }],
      },
      { _id: 0, id: 1, source: 1, identifier: 1, maxSeverityRank: 1, sent: 1, expiresAt: 1, info: { $slice: 1 } },
    )
    // Matches the index order, so the sort is index-served rather than in memory.
    .sort({ sent: -1, maxSeverityRank: -1 })
    // Force the index. This collection has a history of planner thrash (see the
    // geo-index hints), and the "active" indexes look tempting for this shape.
    .hint("alert_sent_sev_ix")
    .limit(500)
    .lean()
    .exec();

  const alerts = (alertDocs as any[])
    .map((a) => ({
      id: a.id,
      source: a.source,
      identifier: a.identifier,
      severityRank: a.maxSeverityRank ?? 0,
      sent: a.sent || null,
      expires: a.expiresAt || null,
      event: a.info?.[0]?.event ?? "",
      headline: a.info?.[0]?.headline ?? "",
      area: a.info?.[0]?.area?.[0]?.areaDesc ?? "",
    }))
    // Severity-first is the useful reading order, but sorting on it in Mongo is
    // what would have cost the index. 500 rows sort here for nothing.
    .sort((x, y) => y.severityRank - x.severityRank || String(y.sent).localeCompare(String(x.sent)));

  // --- seismic: the permanent record, not the expiring working set -----------
  const quakes = (
    await db.quakeArchive.list({ fromMs: +from, toMs: +to, limit: 500 })
  ).map((q) => ({
    quakeId: q.quakeId,
    mag: q.mag,
    place: q.place ?? "",
    time: new Date(q.time).toISOString(),
    depthKm: q.depthKm,
    lng: q.lng,
    lat: q.lat,
    url: q.url,
    tsunami: !!q.tsunami,
  }));

  // --- what actually aired that day -----------------------------------------
  const airDocs = await db.airLog.entryModel
    .find(
      { startedAt: { $gte: from, $lte: to } },
      { _id: 0, kind: 1, segmentId: 1, title: 1, subtitle: 1, startedAt: 1, breaking: 1 },
    )
    .sort({ startedAt: 1 })
    // Index-served by `airentry_started_ix`; the log grows by a row per cut, so
    // a scan-and-sort here would be the same trap as the alert query above.
    .hint("airentry_started_ix")
    .limit(2000)
    .lean()
    .exec();

  const airedCounts: Record<string, number> = {};
  for (const e of airDocs as any[]) airedCounts[e.kind] = (airedCounts[e.kind] ?? 0) + 1;

  return NextResponse.json(
    {
      date: raw,
      from: from.toISOString(),
      to: to.toISOString(),
      maps,
      mapCount: maps.reduce((n, v) => n + v.frames.length, 0),
      alerts,
      quakes,
      aired: {
        cuts: airDocs.length,
        counts: airedCounts,
        first: (airDocs[0] as any)?.startedAt ? new Date((airDocs[0] as any).startedAt).toISOString() : null,
        last: (airDocs[airDocs.length - 1] as any)?.startedAt
          ? new Date((airDocs[airDocs.length - 1] as any).startedAt).toISOString()
          : null,
      },
      at: new Date().toISOString(),
    },
    { status: 200, headers: NO_CACHE },
  );
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
