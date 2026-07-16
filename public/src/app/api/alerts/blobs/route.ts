import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { withCache, FEED_TTL_SEC } from "../../../../lib/focus/focus-cache";
import { simplifyGeometry } from "@photonsurge/shared/geo/simplify";
import type { AlertFeature } from "../../../../lib/alerts";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import type { HazardType } from "@photonsurge/shared/alerts/hazard";

/**
 * GET /api/alerts/blobs — the globe overlay's shapes: touching warning areas of
 * the same hazard+severity already fused into one, by the worker.
 *
 * Why not just draw /api/alerts: MeteoAlarm issues ONE ALERT PER COUNTY, so the
 * globe drew hundreds of little squares where a viewer should read one weather
 * system. Worse, that feed simplifies each area INDEPENDENTLY (~0.05°, to keep
 * the payload off public's heap) — which walks two neighbours' shared border
 * apart and leaves a white seam between provinces that are genuinely touching.
 * Dissolving first removes the internal borders altogether, so there's nothing
 * left to mismatch, and simplification only ever touches the outer edge.
 *
 * All the clipping happened in the worker (see worker/src/alerts/dissolve.ts).
 * This reads the finished shapes — no geometry library comes near public.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** Matches /api/alerts: a globe at this zoom can't show 5km of detail anyway. */
const ALERT_SIMPLIFY_DEG = Number(process.env.ALERT_SIMPLIFY_DEG || 0.05);

/**
 * A blob's text comes from ONE of its members — the shape is the whole point, so
 * this only has to answer "what warning is this" for the select card. Members of
 * a blob share hazard AND severity by construction (that's the bucket key), so
 * any of them tells the same story; newest wins, so the card reflects the latest
 * issue rather than a superseded one.
 */
function pickRepresentative(members: { id: string; sent?: string | Date | null }[]): string | null {
  let best: { id: string; t: number } | null = null;
  for (const m of members) {
    const t = m.sent ? new Date(m.sent).getTime() : 0;
    if (!best || t > best.t) best = { id: m.id, t };
  }
  return best?.id ?? null;
}

/**
 * No query parameters, deliberately. The operator's severity floor and hazard
 * chips filter client-side from warm data, so every caller shares ONE canonical
 * Redis entry — taking a `severityMin` here would fragment the cache per filter
 * combination and make each toggle a fresh compose.
 */
async function GET__impl(_req: Request) {
  try {
    // `withCache` hands back an ENVELOPE — { value, hit } — not the body. Sending
    // it straight to the client wrapped the whole feed in `.value`, the overlay
    // read `.features` off the wrapper, got undefined, and drew nothing: a 2.8MB
    // 200 OK and an empty globe. Every other feed route destructures this.
    const { value, hit } = await withCache(`feed:v1:alert-blobs`, FEED_TTL_SEC, async () => {
      const db = await getAppDb();
      const { blobs } = await db.alertBlobs.list();
      const wanted = blobs;

      // One read for every member we might quote. `omitCoordinates` matters: a
      // blob's members carry the polygons we just spent the worker's CPU fusing,
      // and pulling them back to read a headline would undo the whole point.
      const memberIds = [...new Set(wanted.flatMap((b) => b.memberIds ?? []))];
      const members = memberIds.length
        ? ((await db.alerts.model
            .find(
              { id: { $in: memberIds } },
              // `onset`/`effective` are here for `since` — the moment the hazard
              // starts, which is NOT `sent` (when the bulletin was written). The
              // card's "Active for" row reads it, so without them a clicked blob
              // silently lost that row while a clicked alert kept it.
              //
              // `description` is deliberately absent: it's rendered only in /admin
              // (AlertInfoBlock), which reads the full alert anyway. On air it is
              // pure payload — a paragraph per shape, on a feed polled for every
              // active shape at once, that no pixel would ever show.
              { _id: 0, id: 1, source: 1, identifier: 1, sent: 1, expiresAt: 1, "info.event": 1, "info.severity": 1, "info.headline": 1, "info.instruction": 1, "info.onset": 1, "info.effective": 1, "info.translatedHeadline": 1, "info.translatedInstruction": 1, "info.area.areaDesc": 1 },
            )
            .lean()
            .exec()) as unknown as any[])
        : [];
      const byId = new Map(members.map((m) => [m.id, m]));

      const features: AlertFeature[] = [];
      for (const b of wanted) {
        const geometry = simplifyGeometry(b.geometry as never, ALERT_SIMPLIFY_DEG);
        if (!geometry) continue;

        const repId = pickRepresentative(
          (b.memberIds ?? []).map((id) => ({ id, sent: byId.get(id)?.sent })),
        );
        const rep = repId ? byId.get(repId) : null;
        const info = rep?.info?.[0] ?? {};

        features.push({
          type: "Feature",
          geometry: geometry as { type: string; coordinates: unknown },
          properties: {
            // The REPRESENTATIVE's id, so clicking a shape opens the same card an
            // alert always did (alertFeatureToSegment reads this).
            id: repId ?? b.id,
            source: rep?.source ?? "blob",
            identifier: rep?.identifier ?? "",
            event: info.event ?? b.hazard,
            severityRank: (b.severityRank ?? 0) as SeverityRank,
            hazard: b.hazard as HazardType,
            areaDesc: info.area?.[0]?.areaDesc,
            level: info.severity,
            headline: info.headline,
            instruction: info.instruction,
            translatedHeadline: info.translatedHeadline,
            translatedInstruction: info.translatedInstruction,
            sent: rep?.sent ? new Date(rep.sent).toISOString() : undefined,
            // When the HAZARD starts, not when the bulletin was written — mirrors
            // /api/alerts' `since`. alertFeatureToSegment reads this and nothing
            // else for the "Active for" row, so emitting only `sent` meant a blob's
            // card quietly dropped it.
            since: info.onset ?? info.effective ?? (rep?.sent ? new Date(rep.sent).toISOString() : undefined),
            expires: rep?.expiresAt,
            // How many warnings this one shape stands for, so a card can say "37
            // warnings" instead of implying it's a single county's.
            //
            // The cities under the blob are deliberately NOT here. This feed
            // exists to DRAW, and it's polled for every active shape at once —
            // Spain's heat blob alone covers ~1,000 cities, which is a lot of
            // payload for something no pixel needs. Anything asking "who's under
            // this" is asking about the on-air shot, and focus already answers
            // that per-cut with conditions attached (see focus areaBlobs).
            memberCount: b.memberIds?.length ?? 0,
          } as unknown as AlertFeature["properties"],
        });
      }
      return { features, count: features.length };
    });

    return NextResponse.json(value, {
      status: 200,
      headers: { ...NO_CACHE, "X-Cache": hit ? "hit" : "miss" },
    });
  } catch (err) {
    // The overlay keeps its last good features, so an empty list here just means
    // "nothing new to draw" rather than blanking the globe mid-broadcast.
    return NextResponse.json(
      { features: [], count: 0, error: String(err) },
      { status: 200, headers: NO_CACHE },
    );
  }
}

export const GET = withApiLog(GET__impl);
