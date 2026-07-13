import { createHash } from "crypto";
import type { iWatchedEvent } from "@photonsurge/shared/db/watched-event-model";
import type { EventResourceKind } from "@photonsurge/shared/db/event-resource-model";
import type { NewEventTimelineUpdate } from "@photonsurge/shared/db/event-timeline-update-model";
import type { AcquireContext, AcquireResult, ExternalSource } from "./source-types";

/**
 * deep-GDACS — the first external adapter. GDACS is our primary global feed, so
 * for a GDACS-primary WatchedEvent the match is EXPLICIT (the event's
 * primarySourceId already encodes `${eventtype}${eventid}`). This goes BEYOND the
 * EVENTS4APP feed the alert ingest polls: it hits `geteventdata` for the richer
 * per-event detail — episode alert level, impact scores, official maps/reports —
 * and appends them to the unified dossier.
 *
 * NB the exact `geteventdata` field paths should be VERIFIED against the live
 * response; `normalizeGdacsDetail` is defensive (optional-chained) and covered by
 * a fixture test, so a shape drift degrades gracefully rather than throwing.
 */

const GDACS_DETAIL = "https://www.gdacs.org/gdacsapi/api/events/geteventdata";
const SOURCE_ID = "gdacs-detail";

const userAgent = () =>
  process.env.ALERTS_GDACS_USER_AGENT ||
  "Mozilla/5.0 LiveWeatherGlobe/0.1 (personal weather globe; ravergeek@gmail.com)";

/** Split a GDACS primary id ("TC1000123") into its event-type + numeric id. */
export function parseGdacsPrimaryId(id: string): { eventType: string; eventid: string } | null {
  const m = /^([A-Za-z]{2})(\d+)$/.exec(id ?? "");
  return m ? { eventType: m[1].toUpperCase(), eventid: m[2] } : null;
}

export interface GdacsResourceRef {
  url: string;
  kind: EventResourceKind;
  title?: string;
}

export interface GdacsDetailNormalized {
  alertLevel?: string;
  eventName?: string;
  series: { metric: string; value: number }[];
  resources: GdacsResourceRef[];
  /** The stable basis used for the change-detection hash. */
  hashBasis: string;
}

const asNum = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
};

/** Guess a resource kind from a URL's extension (defaults to LINK). */
function kindOfUrl(url: string): EventResourceKind {
  const u = url.toLowerCase();
  if (u.endsWith(".pdf")) return "REPORT";
  if (u.endsWith(".kml") || u.endsWith(".kmz")) return "KML";
  if (u.endsWith(".json") || u.endsWith(".geojson")) return "GEOJSON";
  if (/\.(png|jpe?g|gif|webp)$/.test(u)) return "IMAGE";
  return "LINK";
}

/** Pure, defensive extraction of the useful bits from a GDACS geteventdata payload. */
export function normalizeGdacsDetail(json: any): GdacsDetailNormalized {
  const f = json?.features?.[0] ?? json ?? {};
  const p = f?.properties ?? f ?? {};

  const series: { metric: string; value: number }[] = [];
  const addMetric = (metric: string, v: unknown) => {
    const n = asNum(v);
    if (n !== undefined) series.push({ metric, value: n });
  };
  addMetric("alertscore", p.alertscore);
  addMetric("episodealertscore", p.episodealertscore);
  addMetric("severity", p.severitydata?.severity);
  addMetric("population", p.population ?? p.affectedpopulation);

  const resources: GdacsResourceRef[] = [];
  const seen = new Set<string>();
  const pushRes = (url: unknown, kind: EventResourceKind | null, title?: string) => {
    // Skip non-URLs and GDACS's unfilled template links (e.g. ".../{identifiers.val}...").
    if (typeof url !== "string" || !/^https?:\/\//.test(url) || /[{}]/.test(url) || seen.has(url)) return;
    seen.add(url);
    resources.push({ url, kind: kind ?? kindOfUrl(url), title });
  };
  pushRes(p.url?.report, "REPORT", "GDACS event report");
  pushRes(p.url?.details, "LINK", "GDACS event details");
  pushRes(p.url?.geometry, "GEOJSON", "GDACS geometry");
  pushRes(p.url?.media, "LINK", "GDACS media");
  pushRes(p.url?.eventnews, "LINK", "GDACS news");
  pushRes(p.iconoverall ?? p.icon, "IMAGE", "GDACS icon");
  // Official maps/images: the live payload keys them by NAME under `images` (a dict), not
  // a single `mapimage` (verified against geteventdata) — e.g. overviewmap, populationmap,
  // shakemap_* . Harvest each; a *map* name → MAP, else IMAGE. Skip directory listings.
  if (p.images && typeof p.images === "object" && !Array.isArray(p.images)) {
    for (const [name, u] of Object.entries(p.images as Record<string, unknown>)) {
      if (typeof u !== "string" || u.endsWith("/")) continue;
      pushRes(u, /map/i.test(name) ? "MAP" : "IMAGE", `GDACS ${name}`);
    }
  }
  // Impact export links live under `impacts[].resource` (per-source dict of URLs).
  if (Array.isArray(p.impacts)) {
    for (const im of p.impacts) {
      const rr = im?.resource;
      if (rr && typeof rr === "object") {
        for (const [name, u] of Object.entries(rr as Record<string, unknown>)) {
          pushRes(u, "REPORT", `GDACS ${[im?.source, name].filter(Boolean).join(" ")}`);
        }
      }
    }
  }
  // The most recent shakemap's detail link.
  if (Array.isArray(p.shakemap) && p.shakemap.length) {
    const latest = p.shakemap.find((s: any) => s?.last) ?? p.shakemap[0];
    pushRes(latest?.url, "LINK", "GDACS shakemap");
  }
  // Legacy / other-event-type fallbacks (harmless when absent).
  pushRes(p.mapimage, "MAP", "GDACS map");
  if (Array.isArray(p.resources)) {
    for (const r of p.resources) pushRes(r?.url ?? r?.uri, null, r?.title ?? r?.name);
  }

  const alertLevel = typeof p.alertlevel === "string" ? p.alertlevel : undefined;
  const eventName = typeof p.name === "string" ? p.name : typeof p.eventname === "string" ? p.eventname : undefined;

  const hashBasis = JSON.stringify([
    alertLevel ?? "",
    series.map((s) => `${s.metric}=${s.value}`),
    resources.map((r) => r.url).sort(),
  ]);

  return { alertLevel, eventName, series, resources, hashBasis };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const gdacsDetailSource: ExternalSource = {
  id: SOURCE_ID,

  enabled: () => process.env.EVENT_GDACS_DETAIL_ENABLED !== "false",

  appliesTo: (event: iWatchedEvent) =>
    event.primarySource === "gdacs" && parseGdacsPrimaryId(event.primarySourceId) != null,

  async acquire(ctx: AcquireContext): Promise<AcquireResult> {
    const { db, event, now } = ctx;
    const f = ctx.fetchImpl ?? fetch;
    const parsed = parseGdacsPrimaryId(event.primarySourceId);
    if (!parsed) return { changed: false, timeline: 0, resources: 0, series: 0 };

    const detailUrl = `${GDACS_DETAIL}?eventtype=${parsed.eventType}&eventid=${parsed.eventid}`;
    const res = await f(detailUrl, { headers: { "User-Agent": userAgent(), Accept: "application/json" } });
    if (!res.ok) throw new Error(`gdacs geteventdata ${res.status} for ${event.primarySourceId}`);
    const json = await res.json();
    const norm = normalizeGdacsDetail(json);
    const payloadHash = sha256(norm.hashBasis);

    const { changed, firstSeen } = await db.eventSources.observe({
      eventId: event.id!,
      source: SOURCE_ID,
      sourceEventId: parsed.eventid,
      sourceUrl: norm.resources.find((r) => r.kind === "REPORT")?.url,
      payloadHash,
      normalized: { alertLevel: norm.alertLevel, eventName: norm.eventName, series: norm.series },
      now,
    });

    // Record the explicit link once (never re-fuzzy-match GDACS — it IS the primary).
    await db.eventLinks.upsertLink({
      eventId: event.id!,
      source: "gdacs",
      externalId: parsed.eventid,
      matchMethod: "EXPLICIT_ID",
    });

    if (!changed) return { changed: false, timeline: 0, resources: 0, series: 0 };

    // Append the raw revision (audit trail).
    await db.eventSourceRevisions.append({
      eventId: event.id!,
      source: SOURCE_ID,
      acquiredAt: now.toISOString(),
      payloadHash,
      normalized: { alertLevel: norm.alertLevel, series: norm.series },
    });

    // Numeric series (deltas over time — dedup-on-change in the repo).
    let seriesAppended = 0;
    for (const s of norm.series) {
      const r = await db.eventSeries.appendSample({
        eventId: event.id!,
        source: "gdacs",
        metric: s.metric,
        value: s.value,
        t: now.getTime(),
      });
      if (r.appended) seriesAppended++;
    }

    // Official resources (reference links, NOT rebroadcast-safe).
    const up = await db.eventResources.upsertMany(
      norm.resources.map((r) => ({
        eventId: event.id!,
        source: "gdacs",
        url: r.url,
        kind: r.kind,
        title: r.title,
        sourceName: "GDACS",
        attribution: "Global Disaster Alert and Coordination System (GDACS)",
        rebroadcastSafe: false,
      })),
    );

    // Timeline beats.
    const at = now.toISOString();
    const beats: NewEventTimelineUpdate[] = [];
    if (firstSeen) {
      beats.push({ eventId: event.id!, at, type: "SOURCE_LINKED", label: "GDACS detail linked", source: "gdacs" });
    }
    if (norm.alertLevel) {
      beats.push({
        eventId: event.id!,
        at,
        type: "IMPACT_UPDATE",
        label: `GDACS alert level ${norm.alertLevel}`,
        source: "gdacs",
        payloadHash,
      });
    }
    if (up.upserted > 0) {
      beats.push({
        eventId: event.id!,
        at,
        type: "PRODUCT_ADDED",
        label: `${up.upserted} new GDACS product${up.upserted === 1 ? "" : "s"}`,
        source: "gdacs",
        payloadHash,
      });
    }
    const tl = await db.eventTimeline.appendMany(beats);

    return { changed: true, timeline: tl.inserted, resources: up.upserted, series: seriesAppended };
  },
};
