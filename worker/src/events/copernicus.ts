import { createHash } from "crypto";
import type { iWatchedEvent } from "@photonsurge/shared/db/watched-event-model";
import type { WatchedEventType } from "@photonsurge/shared/events/types";
import type { EventResourceKind } from "@photonsurge/shared/db/event-resource-model";
import type { NewEventTimelineUpdate } from "@photonsurge/shared/db/event-timeline-update-model";
import type { AcquireContext, AcquireResult, ExternalSource } from "./source-types";
import { parseGdacsPrimaryId } from "./gdacs-detail";
import { haversineKm } from "./geo";

/**
 * Copernicus EMS — Rapid Mapping activations (spec §11). Public, keyless. The
 * detail payload carries a GDACS id, so for a GDACS-primary WatchedEvent the
 * match is EXPLICIT (no fuzzy guessing); non-GDACS events fall back to a centroid
 * proximity match (DERIVED). Products (delineation/grading maps, source imagery,
 * ZIPs, S3 assets) become official EventResources — reference links, NOT
 * rebroadcast-safe. Real endpoints, but the exact field paths are VERIFY-flagged:
 * the parsers are defensive (recursive URL harvest) so a shape drift degrades
 * gracefully rather than throwing.
 */

const SOURCE_ID = "copernicus";

/**
 * Event types Copernicus EMS plausibly maps. WEATHER_ALERT — the ordinary
 * warning, and 927 of our 1,148 scheduled events — is deliberately absent: EMS
 * responds to disasters, not to advisories.
 */
const EMS_TYPES = new Set<WatchedEventType>([
  "FLOOD",
  "WILDFIRE",
  "CYCLONE",
  "EARTHQUAKE",
  "DROUGHT",
  "VOLCANO",
]);
const BASE = process.env.COPERNICUS_EMS_API || "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api";
const LIST_URL = `${BASE}/public-activations-info/`;
const detailUrl = (code: string) => `${BASE}/public-activations/?code=${encodeURIComponent(code)}`;

const MATCH_RADIUS_KM = Number(process.env.EVENT_COPERNICUS_RADIUS_KM || 400);
const MIN_SCORE = Number(process.env.EVENT_COPERNICUS_MIN_SCORE || 0.5);
const URL_CAP = 60;
/** The activation list is the SAME for every event, so cache it: without this the
 *  list is re-fetched once per event per sweep (~20/min), which rate-limits the public
 *  endpoint into 502s. One fetch per TTL, shared across all events' acquires. */
const LIST_TTL_MS = Number(process.env.EVENT_COPERNICUS_LIST_TTL_MS || 10 * 60 * 1000);

/** Transient upstream statuses — a retry-next-cadence hiccup, not a hard error. */
const isTransientStatus = (status: number) => status === 429 || status >= 500;

/** A pared-down activation from the LIST feed — enough to match on. */
export interface ActivationListItem {
  code: string;
  gdacsNumericId?: string;
  centroid: [number, number] | null;
  status?: string;
  title?: string;
}

const digitsOf = (v: unknown): string | undefined => {
  const m = /(\d{3,})/.exec(String(v ?? ""));
  return m ? m[1] : undefined;
};

/** Defensive [lng,lat] from the many shapes a centroid can take. */
export function parseCentroid(v: unknown): [number, number] | null {
  if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number") return [v[0], v[1]];
  const o = v as { lng?: number; lon?: number; longitude?: number; lat?: number; latitude?: number; coordinates?: unknown } | null;
  if (o && typeof o === "object") {
    if (Array.isArray(o.coordinates)) return parseCentroid(o.coordinates);
    const lng = o.lng ?? o.lon ?? o.longitude;
    const lat = o.lat ?? o.latitude;
    if (typeof lng === "number" && typeof lat === "number") return [lng, lat];
  }
  return null;
}

/** Extract the matchable list items from whatever envelope the list endpoint uses. */
export function parseActivationList(json: any): ActivationListItem[] {
  const arr: any[] = Array.isArray(json)
    ? json
    : json?.activations ?? json?.results ?? json?.features ?? json?.data ?? [];
  return arr
    .map((a: any) => {
      const p = a?.properties ?? a;
      const code = String(p?.code ?? p?.emsrCode ?? p?.activationCode ?? p?.id ?? "");
      if (!code) return null;
      return {
        code,
        gdacsNumericId: digitsOf(p?.gdacsId ?? p?.gdacs_id ?? p?.gdacs ?? p?.gdacsEventId),
        centroid: parseCentroid(p?.centroid ?? p?.center ?? p?.eventCentroid ?? a?.geometry),
        status: typeof p?.status === "string" ? p.status : undefined,
        title: typeof p?.title === "string" ? p.title : typeof p?.name === "string" ? p.name : undefined,
      } as ActivationListItem;
    })
    .filter((x: ActivationListItem | null): x is ActivationListItem => !!x);
}

export interface ActivationMatch {
  code: string;
  method: "EXPLICIT_ID" | "DERIVED";
  score?: number;
}

/** Match a WatchedEvent to an activation — GDACS id first (explicit), else proximity. */
export function matchActivation(event: Pick<iWatchedEvent, "primarySource" | "primarySourceId" | "repPoint">, items: ActivationListItem[]): ActivationMatch | null {
  // Explicit: GDACS-primary event whose numeric id equals an activation's GDACS id.
  if (event.primarySource === "gdacs") {
    const parsed = parseGdacsPrimaryId(event.primarySourceId);
    if (parsed) {
      const hit = items.find((i) => i.gdacsNumericId && i.gdacsNumericId === parsed.eventid);
      if (hit) return { code: hit.code, method: "EXPLICIT_ID" };
    }
  }
  // Derived: nearest activation centroid within the radius.
  const ep = event.repPoint?.coordinates;
  if (!ep) return null;
  let best: ActivationMatch | null = null;
  for (const i of items) {
    if (!i.centroid) continue;
    const km = haversineKm(ep[1], ep[0], i.centroid[1], i.centroid[0]);
    const score = km <= MATCH_RADIUS_KM ? 1 - km / MATCH_RADIUS_KM : 0;
    if (score >= MIN_SCORE && (!best || (best.score ?? 0) < score)) best = { code: i.code, method: "DERIVED", score: Math.round(score * 100) / 100 };
  }
  return best;
}

/** Recursively harvest http(s)/s3 URLs from the detail payload (shape-agnostic). */
export function harvestUrls(node: unknown, out: Set<string> = new Set()): string[] {
  const walk = (n: unknown) => {
    if (out.size >= URL_CAP) return;
    if (typeof n === "string") {
      if (/^https?:\/\//.test(n) || /^s3:\/\//.test(n)) out.add(n);
      return;
    }
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    if (n && typeof n === "object") {
      for (const v of Object.values(n as Record<string, unknown>)) walk(v);
    }
  };
  walk(node);
  return [...out];
}

export interface CopernicusNormalized {
  activationId: string;
  title?: string;
  status?: string;
  eventTime?: string;
  lastUpdate?: string;
  urls: string[];
  hashBasis: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Pure, defensive extraction of the useful bits of an activation detail payload. */
export function normalizeCopernicusDetail(json: any, code: string): CopernicusNormalized {
  const a = json?.activation ?? json?.data ?? json?.properties ?? json ?? {};
  const urls = harvestUrls(json);
  const status = str(a.status ?? a.activationStatus ?? a.drmPhase);
  const lastUpdate = str(a.lastUpdate ?? a.last_update ?? a.updated);
  const eventTime = str(a.eventTime ?? a.event_time ?? a.eventDate ?? a.activationTime);
  const title = str(a.title ?? a.name);
  const hashBasis = JSON.stringify([status ?? "", lastUpdate ?? "", urls.length, urls.slice().sort()]);
  return { activationId: code, title, status, eventTime, lastUpdate, urls, hashBasis };
}

function resourceKind(url: string): EventResourceKind {
  const u = url.toLowerCase();
  if (/\/(wms|wfs|wmts|rest\/services)|arcgis|geoserver/.test(u)) return "SERVICE";
  if (u.endsWith(".pdf")) return "MAP";
  if (/\.(tif|tiff|jp2|zip)$/.test(u)) return "DATA";
  if (/\.(json|geojson)$/.test(u)) return "GEOJSON";
  if (/\.(kml|kmz)$/.test(u)) return "KML";
  if (/\.(png|jpe?g|webp)$/.test(u)) return "IMAGE";
  return "MAP";
}

const isClosed = (status?: string) => !!status && /clos|complet|terminat|ended/i.test(status);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Process-wide cache of the (identical-for-every-event) activation list. */
let listCache: { items: ActivationListItem[]; atMs: number } | null = null;

/** Test hook — clear the module cache between cases. */
export function _resetCopernicusCache(): void {
  listCache = null;
}

/**
 * Load the activation list, shared across events via a TTL cache. Returns null on a
 * transient outage with no cached list to fall back on (the caller then soft-skips and
 * retries next cadence — no thrown error, no log spam). A non-transient 4xx (a genuine
 * contract break, e.g. the endpoint moved) still throws so it surfaces loudly.
 */
async function loadActivationList(f: typeof fetch, now: Date): Promise<ActivationListItem[] | null> {
  if (listCache && now.getTime() - listCache.atMs < LIST_TTL_MS) return listCache.items;
  let res: Response;
  try {
    res = await f(LIST_URL, { headers: { Accept: "application/json" } });
  } catch (err) {
    if (listCache) return listCache.items; // network blip → serve stale
    throw err;
  }
  if (!res.ok) {
    if (listCache) return listCache.items; // any error → prefer a stale list over none
    if (isTransientStatus(res.status)) return null; // transient + cold cache → soft skip
    throw new Error(`copernicus list ${res.status}`);
  }
  const items = parseActivationList(await res.json());
  listCache = { items, atMs: now.getTime() };
  return items;
}

export const copernicusSource: ExternalSource = {
  id: SOURCE_ID,

  enabled: () => process.env.EVENT_COPERNICUS_ENABLED !== "false",

  /**
   * Disasters only — never a routine weather warning.
   *
   * This was `!!event.repPoint`, i.e. "any event that has a location", which is
   * every alert we hold. Copernicus EMS activates a few hundred times a YEAR, for
   * major disasters a national authority has escalated; it is never going to hold
   * a rapid-mapping product for a regional yellow wind advisory. Asking anyway
   * cost 927 of 1,148 scheduled events — 81% of the acquisition queue — each
   * re-asking every few minutes, forever.
   *
   * The yield of that, measured across the whole layer's lifetime: ZERO. Not "few"
   * — no Copernicus link has ever been made, while EONET made 18 and GDACS 3.
   *
   * A WEATHER_ALERT is the ordinary case (927 of them) and is exactly what EMS
   * does not cover. The typed events are the ones that can plausibly hit: a flood,
   * a wildfire, a cyclone, an earthquake — or anything GDACS itself raised, which
   * is disaster-scale by definition.
   */
  appliesTo: (event: iWatchedEvent) =>
    event.primarySource === "gdacs" || (!!event.repPoint && EMS_TYPES.has(event.type)),

  async acquire(ctx: AcquireContext): Promise<AcquireResult> {
    const { db, event, now } = ctx;
    const f = ctx.fetchImpl ?? fetch;
    const empty: AcquireResult = { changed: false, timeline: 0, resources: 0, series: 0 };

    // Resolve an existing link, else search the list and (maybe) match.
    const links = await db.eventLinks.listForEvent(event.id!);
    const linked = links.find((l) => l.source === SOURCE_ID);
    let code: string;
    let firstMatch = false;

    if (linked) {
      code = linked.externalId;
    } else {
      const items = await loadActivationList(f, now);
      if (!items) return empty; // transient list outage — retry next cadence, quietly
      const match = matchActivation(event, items);
      if (!match) return empty;
      code = match.code;
      firstMatch = true;
      await db.eventLinks.upsertLink({
        eventId: event.id!,
        source: SOURCE_ID,
        externalId: code,
        matchMethod: match.method,
        matchScore: match.score,
      });
    }

    let dRes: Response;
    try {
      dRes = await f(detailUrl(code), { headers: { Accept: "application/json" } });
    } catch {
      return empty; // network blip on the per-event detail — retry next cadence
    }
    if (!dRes.ok) {
      if (isTransientStatus(dRes.status)) return empty; // transient → soft skip
      throw new Error(`copernicus detail ${dRes.status}`);
    }
    const norm = normalizeCopernicusDetail(await dRes.json(), code);
    const payloadHash = sha256(norm.hashBasis);

    const { changed, firstSeen } = await db.eventSources.observe({
      eventId: event.id!,
      source: SOURCE_ID,
      sourceEventId: code,
      sourceUrl: `https://rapidmapping.emergency.copernicus.eu/${code}`,
      payloadHash,
      normalized: { title: norm.title, status: norm.status, lastUpdate: norm.lastUpdate, products: norm.urls.length },
      now,
    });
    if (!changed && !firstMatch) return empty;

    await db.eventSourceRevisions.append({
      eventId: event.id!,
      source: SOURCE_ID,
      acquiredAt: now.toISOString(),
      payloadHash,
      normalized: { status: norm.status, lastUpdate: norm.lastUpdate, productCount: norm.urls.length },
    });

    const up = await db.eventResources.upsertMany(
      norm.urls.map((url) => ({
        eventId: event.id!,
        source: SOURCE_ID,
        url,
        kind: resourceKind(url),
        title: `Copernicus EMS ${code} product`,
        sourceName: "Copernicus EMS Rapid Mapping",
        attribution: "© Copernicus Emergency Management Service (Rapid Mapping)",
        rebroadcastSafe: false,
      })),
    );

    const at = now.toISOString();
    const beats: NewEventTimelineUpdate[] = [];
    if (firstSeen || firstMatch) {
      beats.push({ eventId: event.id!, at, type: "SOURCE_LINKED", label: `Copernicus EMS activation ${code}`, source: SOURCE_ID, refUrl: `https://rapidmapping.emergency.copernicus.eu/${code}` });
    }
    if (up.upserted > 0) {
      beats.push({ eventId: event.id!, at, type: "PRODUCT_ADDED", label: `${up.upserted} new Copernicus mapping product${up.upserted === 1 ? "" : "s"}`, source: SOURCE_ID, payloadHash });
    }
    if (isClosed(norm.status)) {
      beats.push({ eventId: event.id!, at, type: "CLOSED", label: "Copernicus activation completed", source: SOURCE_ID, payloadHash });
    }
    const tl = await db.eventTimeline.appendMany(beats);

    return { changed: true, timeline: tl.inserted, resources: up.upserted, series: 0 };
  },
};
