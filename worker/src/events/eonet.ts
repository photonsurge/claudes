import { createHash } from "crypto";
import type { iWatchedEvent } from "@photonsurge/shared/db/watched-event-model";
import type { WatchedEventType } from "@photonsurge/shared/events/types";
import type { NewEventTimelineUpdate } from "@photonsurge/shared/db/event-timeline-update-model";
import type { AcquireContext, AcquireResult, ExternalSource } from "./source-types";
import { haversineKm, representativePoint } from "./geo";
import { discardBody } from "../http";

/**
 * EONET — NASA's Earth Observatory Natural Event Tracker. A CHEAP keyless
 * cross-reference (spec §22): it doesn't drive the dossier, it enriches it with
 * curated source links, a geometry history and a closure signal, and hints which
 * GIBS imagery layer fits. Matched by category + geographic proximity to the
 * event's repPoint (DERIVED), so it's conservative — only a high-confidence match
 * auto-links (a wrong EONET link is low-harm but we still gate it).
 *
 * Live response paths are defensive-parsed (fixture-tested); a shape drift
 * degrades to "no match" rather than throwing.
 */

const EONET_EVENTS = "https://eonet.gsfc.nasa.gov/api/v3/events";
const SOURCE_ID = "eonet";

/** WatchedEvent type → EONET category id (events with no mapped category are skipped). */
const EONET_CATEGORY: Partial<Record<WatchedEventType, string>> = {
  CYCLONE: "severeStorms",
  FLOOD: "floods",
  WILDFIRE: "wildfires",
  DROUGHT: "drought",
  EARTHQUAKE: "earthquakes",
};

/** Max distance (km) for a proximity match, and the minimum score to auto-link. */
const MATCH_RADIUS_KM = Number(process.env.EVENT_EONET_RADIUS_KM || 500);
const MIN_SCORE = Number(process.env.EVENT_EONET_MIN_SCORE || 0.6);
/** The open-events list per category is the same for every event in that category, so
 *  cache it (keyed by category) — otherwise it's re-fetched once per event per sweep. */
const LIST_TTL_MS = Number(process.env.EVENT_EONET_LIST_TTL_MS || 10 * 60 * 1000);

/** Transient upstream statuses — a retry-next-cadence hiccup, not a hard error. */
const isTransientStatus = (status: number) => status === 429 || status >= 500;

export interface EonetNormalized {
  eonetId: string;
  title: string;
  categories: string[];
  sources: { id?: string; url: string }[];
  geometryDates: string[];
  latestPoint: [number, number] | null;
  closed: string | null;
  hashBasis: string;
}

/** Pure, defensive extraction of the useful bits of one EONET event. */
export function normalizeEonetEvent(evt: any): EonetNormalized {
  const geom = Array.isArray(evt?.geometry) ? evt.geometry : [];
  const geometryDates = geom.map((g: any) => String(g?.date ?? "")).filter(Boolean);
  const last = geom[geom.length - 1];
  const latestPoint = last ? representativePoint(last) : null;
  const sources = (Array.isArray(evt?.sources) ? evt.sources : [])
    .map((s: any) => ({ id: typeof s?.id === "string" ? s.id : undefined, url: s?.url }))
    .filter((s: any) => typeof s.url === "string" && /^https?:\/\//.test(s.url));
  const categories = (Array.isArray(evt?.categories) ? evt.categories : [])
    .map((c: any) => c?.id)
    .filter((c: any): c is string => typeof c === "string");

  const eonetId = String(evt?.id ?? "");
  const title = typeof evt?.title === "string" ? evt.title : eonetId;
  const closed = typeof evt?.closed === "string" ? evt.closed : null;
  const hashBasis = JSON.stringify([closed ?? "", geometryDates, sources.map((s: any) => s.url).sort()]);

  return { eonetId, title, categories, sources, geometryDates, latestPoint, closed, hashBasis };
}

/** Score an EONET event against a WatchedEvent (0 = no match, 1 = same place). */
export function scoreEonetMatch(event: Pick<iWatchedEvent, "type" | "repPoint">, norm: EonetNormalized): number {
  const wantCat = EONET_CATEGORY[event.type];
  if (wantCat && !norm.categories.includes(wantCat)) return 0;
  const ep = event.repPoint?.coordinates;
  if (!ep || !norm.latestPoint) return 0;
  const km = haversineKm(ep[1], ep[0], norm.latestPoint[1], norm.latestPoint[0]);
  return km <= MATCH_RADIUS_KM ? 1 - km / MATCH_RADIUS_KM : 0;
}

/** Best-scoring EONET candidate for an event, or null if none clears MIN_SCORE. */
export function bestEonetMatch(
  event: Pick<iWatchedEvent, "type" | "repPoint">,
  candidates: EonetNormalized[],
): { norm: EonetNormalized; score: number } | null {
  let best: { norm: EonetNormalized; score: number } | null = null;
  for (const norm of candidates) {
    const score = scoreEonetMatch(event, norm);
    if (score >= MIN_SCORE && (!best || score > best.score)) best = { norm, score };
  }
  return best;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Per-category cache of the normalised open-events list. */
const listCache = new Map<string, { items: EonetNormalized[]; atMs: number }>();

/** Test hook — clear the module cache between cases. */
export function _resetEonetCache(): void {
  listCache.clear();
}

/**
 * Load the open-events candidate list for a category, shared across events via a TTL
 * cache. Returns null on a transient outage with no cached list (the caller soft-skips
 * and retries next cadence — no thrown error, no log spam). A non-transient failure
 * still throws so a real contract break surfaces.
 */
async function loadCategoryEvents(f: typeof fetch, cat: string | undefined, now: Date): Promise<EonetNormalized[] | null> {
  const key = cat ?? "*";
  const cached = listCache.get(key);
  if (cached && now.getTime() - cached.atMs < LIST_TTL_MS) return cached.items;
  let res: Response;
  try {
    res = await f(`${EONET_EVENTS}?status=open${cat ? `&category=${cat}` : ""}`);
  } catch (err) {
    if (cached) return cached.items; // network blip → serve stale
    throw err;
  }
  if (!res.ok) {
    discardBody(res);
    if (cached) return cached.items;
    if (isTransientStatus(res.status)) return null;
    throw new Error(`eonet events ${res.status}`);
  }
  const json = await res.json();
  const items: EonetNormalized[] = (Array.isArray(json?.events) ? json.events : []).map(normalizeEonetEvent);
  listCache.set(key, { items, atMs: now.getTime() });
  return items;
}

export const eonetSource: ExternalSource = {
  id: SOURCE_ID,

  enabled: () => process.env.EVENT_EONET_ENABLED !== "false",

  appliesTo: (event: iWatchedEvent) => !!event.repPoint && EONET_CATEGORY[event.type] != null,

  async acquire(ctx: AcquireContext): Promise<AcquireResult> {
    const { db, event, now } = ctx;
    const f = ctx.fetchImpl ?? fetch;
    const empty: AcquireResult = { changed: false, timeline: 0, resources: 0, series: 0 };

    // Resolve an existing link, else search candidates and (maybe) match.
    const links = await db.eventLinks.listForEvent(event.id!);
    const linked = links.find((l) => l.source === SOURCE_ID);
    let norm: EonetNormalized | null = null;
    let firstMatch = false;

    if (linked) {
      let res: Response;
      try {
        res = await f(`${EONET_EVENTS}/${linked.externalId}`);
      } catch {
        return empty; // network blip on the per-event detail — retry next cadence
      }
      if (!res.ok) {
        discardBody(res);
        if (isTransientStatus(res.status)) return empty; // transient → soft skip
        throw new Error(`eonet event ${res.status}`);
      }
      norm = normalizeEonetEvent(await res.json());
    } else {
      const cat = EONET_CATEGORY[event.type];
      const candidates = await loadCategoryEvents(f, cat, now);
      if (!candidates) return empty; // transient list outage — retry next cadence, quietly
      const best = bestEonetMatch(event, candidates);
      if (!best) return empty; // no confident cross-reference
      norm = best.norm;
      firstMatch = true;
      await db.eventLinks.upsertLink({
        eventId: event.id!,
        source: SOURCE_ID,
        externalId: norm.eonetId,
        matchMethod: "DERIVED",
        matchScore: Math.round(best.score * 100) / 100,
      });
    }

    const payloadHash = sha256(norm.hashBasis);
    const { changed, firstSeen } = await db.eventSources.observe({
      eventId: event.id!,
      source: SOURCE_ID,
      sourceEventId: norm.eonetId,
      sourceUrl: norm.sources[0]?.url,
      payloadHash,
      normalized: { title: norm.title, closed: norm.closed },
      now,
    });
    if (!changed && !firstMatch) return empty;

    await db.eventSourceRevisions.append({
      eventId: event.id!,
      source: SOURCE_ID,
      acquiredAt: now.toISOString(),
      payloadHash,
      normalized: { geometryDates: norm.geometryDates, closed: norm.closed },
    });

    const up = await db.eventResources.upsertMany(
      norm.sources.map((s) => ({
        eventId: event.id!,
        source: SOURCE_ID,
        url: s.url,
        kind: "LINK" as const,
        title: s.id ? `EONET source: ${s.id}` : "EONET source",
        sourceName: "NASA EONET",
        attribution: "NASA Earth Observatory Natural Event Tracker (EONET)",
        rebroadcastSafe: false,
      })),
    );

    const at = now.toISOString();
    const beats: NewEventTimelineUpdate[] = [];
    if (firstSeen || firstMatch) {
      beats.push({ eventId: event.id!, at, type: "SOURCE_LINKED", label: "NASA EONET cross-reference linked", source: SOURCE_ID });
    }
    beats.push({
      eventId: event.id!,
      at,
      type: "GEOMETRY_REFINED",
      label: `EONET geometry history (${norm.geometryDates.length} obs)`,
      source: SOURCE_ID,
      payloadHash,
    });
    if (norm.closed) {
      beats.push({ eventId: event.id!, at: norm.closed, type: "CLOSED", label: "EONET marked the event closed", source: SOURCE_ID, payloadHash });
    }
    const tl = await db.eventTimeline.appendMany(beats);

    return { changed: true, timeline: tl.inserted, resources: up.upserted, series: 0 };
  },
};
