/**
 * PURE text builders for the broadcast chrome (tickers + live-alert banner). No
 * DOM, no React — turn the live overlay data (alerts, quakes, tracks) into the
 * short strings the on-air furniture displays, so the formatting is unit-tested
 * and the components stay dumb.
 */
import type { Alert, AlertFeature } from "./alerts";
import { primaryInfo, areaSummary, expiresLabel } from "./alerts";
import type { Quake, Track } from "./tracks/types";
import { SEVERITY_LABELS, SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";
import {
  QUAKE_CLASS_COLORS,
  QUAKE_MAGNITUDE_BANDS,
  quakeMagnitudeClass,
  type QuakeMagnitudeClass,
} from "@photonsurge/shared/seismic";
import { alertRepPoint, continentOf } from "@photonsurge/shared/alerts/geo";
import { hazardMeta, classifyHazard, type HazardType } from "./hazard";
import { broadcastEventLabel } from "@photonsurge/shared/alerts/phrasebook";
import { isoToFlag } from "@photonsurge/shared/tracks/flags";
import { haversineKm, withinBbox, type Nearby, GeoGrid } from "./geo";
import type { City } from "./cities";
import type { Volcano, VolcanoStatus } from "@photonsurge/shared/volcanoes/types";

/**
 * The on-air name for an alert feature — "Severe Thunderstorms", never the
 * source's own `event` ("Strong convection", "Thunderstormwarning", "BÖEN"…).
 * Thin adapter onto the shared phrasebook, which takes `translatedEvent` where
 * the overlay feature carries `translatedHeadline`.
 */
export const alertLabel = (p: AlertFeature["properties"]): string =>
  broadcastEventLabel({
    hazard: p.hazard,
    severityRank: p.severityRank,
    event: p.event,
    translatedEvent: p.translatedHeadline,
  });

/** "SEISMIC M5.9 · 12km SSW of … · TSUNAMI POTENTIAL" */
export function quakeTicker(q: Quake): string {
  const loc = q.place ?? `${q.lat.toFixed(1)}, ${q.lng.toFixed(1)}`;
  return `SEISMIC M${q.mag.toFixed(1)} · ${loc}${q.tsunami ? " · TSUNAMI POTENTIAL" : ""}`;
}

/** Notable-city predicate — a real population or a capital, same as the World
 *  Watch feed so the ticker flags agree with it. Memoised per input array (the
 *  SAME subset array back for the same city list), so the crawl and the World
 *  Watch feed key one shared city grid off it instead of each rebuilding one. */
const notableSubsets = new WeakMap<City[], City[]>();
/** The notable rule: a real population, or a capital. */
export const isNotableCity = (c: City): boolean => (c.population ?? 0) > 0 || !!c.isCapital;
export function notableCities(cities: City[]): City[] {
  let subset = notableSubsets.get(cities);
  if (!subset) {
    subset = cities.filter(isNotableCity);
    notableSubsets.set(cities, subset);
  }
  return subset;
}

/**
 * Nearest candidate city's country flag for a point, "" if none within
 * NEARBY_RADIUS_KM. Answered from the candidates' bucketed grid (built once per
 * array, see cityGrid) — the crawl asks this once per alert, and a full scan of
 * the ~15k notable places per alert was a few ms of every cut's stall. The
 * candidates are used as given; pass the notableCities() subset for the crawl.
 */
function nearestFlag(point: [number, number] | null, candidates: City[]): string {
  if (!point || candidates.length === 0) return "";
  const hit = cityGrid(candidates).nearest(point, NEARBY_RADIUS_KM);
  return hit?.item.cc ? isoToFlag(hit.item.cc) : "";
}

/** "🇫🇯 TSUNAMI WATCH: Fiji Region" (nearest-city flag + severity-prefixed hazard
 *  + area). The flag is omitted when no notable city is close enough to trust (or
 *  no cities were supplied). Pass the notableCities() subset for the flag lookup.
 *  The hazard name is the broadcast phrasebook's, not the source's bulletin
 *  wording (see shared/alerts/phrasebook.ts). */
export function alertTicker(a: AlertFeature, candidateCities: City[] = []): string {
  const p = a.properties;
  const sev = SEVERITY_LABELS[p.severityRank];
  const area = p.areaDesc ? ` · ${p.areaDesc}` : "";
  const event = alertLabel(p);
  const flag = nearestFlag(alertRepPoint(a.geometry), candidateCities);
  return `${flag ? `${flag} ` : ""}${sev ? `${sev.toUpperCase()}: ` : ""}${event}${area}`;
}

/** "VOLCANO ERUPTING: Etna · Italy" — dormant volcanoes never reach the crawl
 *  (callers pass erupting/unrest only, same exclusion as every other surface). */
export function volcanoTicker(v: Volcano): string {
  const status = VOLCANO_STATUS_META[v.status].label.toUpperCase();
  const where = v.country ? ` · ${v.country}` : "";
  return `VOLCANO ${status}: ${v.name}${where}`;
}

/** The crawl's alert subset for a channel: drop hazards on the channel's
 *  crawl-specific off-list (empty = untouched, and the SAME array back so
 *  memo keys stay stable). Layered on top of the globe's own operator filter,
 *  which is applied upstream in useAlertFeatures. */
export function hazardFilteredAlerts(
  alerts: AlertFeature[],
  hazardsOff: readonly string[],
): AlertFeature[] {
  if (!hazardsOff.length) return alerts;
  const off = new Set(hazardsOff);
  return alerts.filter((a) => !off.has(a.properties.hazard));
}

/** "🇺🇸 GLOBAL THUNDER-26 · AIRCRAFT" */
export function trackTicker(t: Track): string {
  const id = t.name || t.code || "UNKNOWN";
  const flag = t.flag ? `${t.flag} ` : "";
  const kind = t.kind === "aircraft" ? "AIRCRAFT" : t.kind === "ship" ? "VESSEL" : "SATELLITE";
  return `${flag}${id} · ${kind}`;
}

/**
 * Collapse the SAME place reported many times (MeteoAlarm emits one row per
 * language — "heftige Gewitter" / "orages violents" / "temporali violenti" for
 * one area — plus cross-source overlaps), keeping the most severe per area. This
 * is what stops the crawl and alert panel repeating one town four times.
 */
export function dedupeAlerts(alerts: AlertFeature[]): AlertFeature[] {
  const byArea = new Map<string, AlertFeature>();
  for (const a of alerts) {
    const p = a.properties;
    const key = (p.areaDesc || p.headline || p.event || p.id).toLowerCase().trim();
    const cur = byArea.get(key);
    if (!cur || p.severityRank > cur.properties.severityRank) byArea.set(key, a);
  }
  return [...byArea.values()];
}

/**
 * All ticker lines from the live data, seismic → volcanoes → alerts → tracks.
 * Alerts are de-duped by area first (kills the multi-language repeats); no cap
 * otherwise — the crawl shows everything (long feeds just scroll longer).
 */
/**
 * The alert crawl lines — deduped by area, then each flagged by its nearest
 * notable city. This is the EXPENSIVE part of the crawl (a per-alert city scan),
 * so it's split out: the component memoises it on just [alerts, cities] and feeds
 * the result to buildTicker as `alertLines`, so it does NOT rerun every time the
 * faster-ticking track feed (dead-reckoned ~1×/s) changes reference.
 */
export function alertTickerLines(alerts: AlertFeature[], cities: City[] = []): string[] {
  const candidates = notableCities(cities);
  return dedupeAlerts(alerts).map((a) => alertTicker(a, candidates));
}

export function buildTicker(input: {
  alerts?: AlertFeature[];
  quakes?: Quake[];
  /** Erupting/unrest volcanoes — dormant entries are skipped here too, so a raw
   *  catalog list can be passed straight through. */
  volcanoes?: Volcano[];
  tracks?: Track[];
  /** Curated, wiki-enriched cities — optional, purely for the per-alert country
   *  flag (nearest notable place). Omit and alerts simply carry no flag. */
  cities?: City[];
  /** Pre-built alert lines (see alertTickerLines) — pass these to reuse a
   *  memoised result instead of re-deriving (and re-flagging) from `alerts`. */
  alertLines?: string[];
}): string[] {
  const items: string[] = [];
  for (const q of input.quakes ?? []) items.push(quakeTicker(q));
  for (const v of input.volcanoes ?? []) if (v.status !== "dormant") items.push(volcanoTicker(v));
  items.push(...(input.alertLines ?? alertTickerLines(input.alerts ?? [], input.cities)));
  for (const t of input.tracks ?? []) items.push(trackTicker(t));
  return [...new Set(items)];
}

/**
 * One crawl entry: a plain feed line, or a flagged sponsored mention the Ticker
 * renders in the accent ink with an AD tag (never disguised as news).
 */
export type TickerEntry = string | { text: string; ad: true };

/** The crawl's sponsored mention for one sponsor. */
export const sponsorLine = (name: string): TickerEntry => ({
  text: `Sponsored by ${name}`,
  ad: true,
});

/**
 * Weave the active sponsors' mentions through the live crawl — each sponsor
 * appears once per loop, spread evenly through the feed instead of clumped at
 * the end (the loop is gapless, so "evenly through" reads as a steady cadence
 * on air). No live items = the mentions alone. No sponsors = the feed untouched.
 */
export function weaveSponsors(items: string[], sponsors: string[]): TickerEntry[] {
  if (!sponsors.length) return items;
  if (!items.length) return sponsors.map(sponsorLine);
  const out: TickerEntry[] = [];
  let placed = 0;
  items.forEach((item, i) => {
    out.push(item);
    // Drop the next mention in once the crawl crosses each 1/n boundary.
    while (
      placed < sponsors.length &&
      i + 1 >= Math.round(((placed + 1) * items.length) / sponsors.length)
    ) {
      out.push(sponsorLine(sponsors[placed]));
      placed += 1;
    }
  });
  return out;
}

/** Active alerts, de-duped by area and sorted most-severe first — the full list. */
export function sortedAlerts(alerts: AlertFeature[]): AlertFeature[] {
  return dedupeAlerts(alerts).sort(
    (a, b) => b.properties.severityRank - a.properties.severityRank,
  );
}

/** How long a freshly-issued alert stays "new", in minutes — the live panel's window. */
export const FRESH_ALERT_WINDOW_MIN = 60;

/**
 * "Just in" alerts — those ISSUED (CAP `sent`) within the last `windowMinutes`.
 * The live alert panel cycles only these, so a warning surfaces when it's issued,
 * holds for about an hour, then drops off on its own EVEN IF the hazard is still
 * active — the panel reads as breaking news, not a standing list of everything
 * live (the always-on World Watch panel is the comprehensive view). Falls back to
 * `since` (onset/effective) when a feature carries no issue time.
 */
export function freshAlerts(
  alerts: AlertFeature[],
  windowMinutes: number = FRESH_ALERT_WINDOW_MIN,
  now: number = Date.now(),
): AlertFeature[] {
  const cutoff = now - windowMinutes * 60_000;
  return alerts.filter((a) => {
    const iso = a.properties.sent ?? a.properties.since;
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) && t >= cutoff;
  });
}

/** "just now" / "12m ago" / "1h 3m ago" — how long since an alert was issued
 *  (empty when the alert carries no usable timestamp). */
export function issuedAgoLabel(iso: string | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((now - t) / 60_000);
  if (mins <= 0) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

/** "45m" / "3h" / "2d" — how long a warning still has to run, or "" when it
 *  carries no usable expiry (or has already lapsed). Pairs with
 *  {@link issuedAgoLabel} on the live card, so a viewer joining mid-hazard is
 *  told how long it holds rather than only when it was written. */
export function expiresInLabel(iso: string | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((t - now) / 60_000);
  if (mins <= 0) return "";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs}h` : `${Math.round(hrs / 24)}d`;
}

/** Lowercased alphanumeric words — for "does this text say anything the card
 *  hasn't already said?" comparisons, which punctuation and case must not sway. */
const normalizeWords = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Collapse sentences a source repeats verbatim. Some feeds ship the same advice
 * twice in one instruction (MET Norway's gale warnings: "Do not go out in a
 * small boat: … Do not go out in a small boat: …"), which doubles the card's
 * body for nothing. A sentence ends at . ! ? … followed by whitespace (so "1.5 m"
 * stays whole), and only four-plus-word sentences count as repeats — a recurring
 * abbreviation fragment ("e.g.") is not a duplicated sentence.
 */
export function dedupeSentences(text: string): string {
  const parts = text.match(/[\s\S]+?(?:[.!?…]+(?=\s|$)|$)/g) ?? [text];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const key = normalizeWords(part);
    if (key.split(" ").filter(Boolean).length >= 4) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(part);
  }
  return kept.join(" ");
}

/**
 * The body copy for the live alert card: the source's official advice when it
 * ships one, else its headline — but the headline only when it is a real
 * sentence saying something the title and area don't. Most feeds' headlines just
 * restate the event, and a card reading "Severe Heat / DETAILS / Heat warning"
 * is worse than a short card.
 *
 * Null when there is nothing worth printing, which is what lets the card size
 * itself to its content instead of holding a fixed height open around a void.
 */
export function alertDetail(
  p: AlertFeature["properties"],
  area = "",
): { label: "OFFICIAL ADVICE" | "DETAILS"; text: string } | null {
  const advice = dedupeSentences((p.translatedInstruction || p.instruction || "").trim());
  if (advice) return { label: "OFFICIAL ADVICE", text: advice };
  const headline = dedupeSentences((p.translatedHeadline || p.headline || "").trim());
  if (!headline) return null;
  const words = normalizeWords(headline).split(" ").filter(Boolean);
  // Fewer than five words is a restated title, not a sentence worth a section.
  if (words.length < 5) return null;
  const known = normalizeWords(`${alertLabel(p)} ${area}`);
  if (words.every((w) => known.includes(w))) return null;
  return { label: "DETAILS", text: headline };
}

/** Active alerts, de-duped by area and sorted most-severe first (top N). */
export function topAlerts(alerts: AlertFeature[], n = 6): AlertFeature[] {
  return sortedAlerts(alerts).slice(0, n);
}

/** The single most severe active alert (drives the event reticle), or null. */
export function topAlert(alerts: AlertFeature[]): AlertFeature | null {
  return topAlerts(alerts, 1)[0] ?? null;
}

/** Alerts actually inside a [west,south,east,north] box (a country spotlight's
 *  approximate bbox) — the app's `alerts` prop is otherwise global, so a
 *  country's "IN VIEW" rollup needs this filter first. Geocode-only alerts
 *  with no derivable representative point are dropped (can't be geographically
 *  scoped rather than wrongly assumed in-country). */
export function scopeAlertsToBbox(
  alerts: AlertFeature[],
  bbox: [number, number, number, number],
): AlertFeature[] {
  return alerts.filter((a) => {
    const pt = alertRepPoint(a.geometry);
    return pt ? withinBbox(pt[0], pt[1], bbox) : false;
  });
}

/** Quakes actually inside a [west,south,east,north] box — see scopeAlertsToBbox. */
export function scopeQuakesToBbox(quakes: Quake[], bbox: [number, number, number, number]): Quake[] {
  return quakes.filter((q) => withinBbox(q.lng, q.lat, bbox));
}

/** Volcanoes actually inside a [west,south,east,north] box — see scopeAlertsToBbox. */
export function scopeVolcanoesToBbox(
  volcanoes: Volcano[],
  bbox: [number, number, number, number],
): Volcano[] {
  return volcanoes.filter((v) => withinBbox(v.lng, v.lat, bbox));
}

/**
 * How near a hazard has to be to a framed event to count as "IN VIEW". A single
 * tracked event (a quake epicentre, an erupting volcano, a storm/aircraft/ship)
 * has no meaningful area, so its rollup uses a fixed great-circle radius around
 * the point rather than the camera's rectangular framing — that box grew and
 * shrank with the zoom, so a tight shot of one volcano still tallied every other
 * volcano across the whole country. 500km keeps "nearby" honest at broadcast
 * scale (roughly the local region around the event).
 */
export const EVENT_SCOPE_RADIUS_KM = 500;

/** Alerts whose representative point is within `radiusKm` of `center` ([lng,lat]).
 *  The point-focus cousin of scopeAlertsToBbox — geocode-only alerts with no
 *  derivable point are dropped (can't be distance-scoped rather than assumed near). */
export function scopeAlertsToRadius(
  alerts: AlertFeature[],
  center: [number, number],
  radiusKm: number = EVENT_SCOPE_RADIUS_KM,
): AlertFeature[] {
  return alerts.filter((a) => {
    const pt = alertRepPoint(a.geometry);
    return pt ? haversineKm(center, pt) <= radiusKm : false;
  });
}

/** Quakes within `radiusKm` of `center` ([lng,lat]) — see scopeAlertsToRadius. */
export function scopeQuakesToRadius(
  quakes: Quake[],
  center: [number, number],
  radiusKm: number = EVENT_SCOPE_RADIUS_KM,
): Quake[] {
  return quakes.filter((q) => haversineKm(center, [q.lng, q.lat]) <= radiusKm);
}

/** Volcanoes within `radiusKm` of `center` ([lng,lat]) — see scopeAlertsToRadius. */
export function scopeVolcanoesToRadius(
  volcanoes: Volcano[],
  center: [number, number],
  radiusKm: number = EVENT_SCOPE_RADIUS_KM,
): Volcano[] {
  return volcanoes.filter((v) => haversineKm(center, [v.lng, v.lat]) <= radiusKm);
}

export interface AreaSummary {
  /** Distinct active alerts in view (de-duped by area + hazard). */
  total: number;
  /** Active earthquakes in view. */
  quakeCount: number;
  /** Erupting/unrest volcanoes in view (dormant excluded, as everywhere else). */
  volcanoCount: number;
  /** Non-zero severity buckets, most severe first. */
  bySeverity: { rank: number; label: string; color: string; count: number }[];
  /** Hazard-type buckets, most common first. */
  byHazard: { hazard: HazardType; label: string; color: string; count: number }[];
}

/**
 * Aggregate the on-screen hazards into a situation summary for wide/area shots
 * (region/global/ocean) — "how many, how severe, what types" — so a busy region
 * reads at a glance instead of needing one card per event. Alerts are de-duped by
 * area + hazard so the same town in four languages counts once.
 */
export function alertSummary(
  alerts: AlertFeature[],
  quakes: Quake[] = [],
  volcanoes: Volcano[] = [],
): AreaSummary {
  const seen = new Map<string, AlertFeature>();
  for (const a of alerts) {
    const p = a.properties;
    const areaKey = (p.areaDesc || p.headline || p.event || p.id).toLowerCase().trim();
    const key = `${areaKey}|${p.hazard}`;
    const cur = seen.get(key);
    if (!cur || p.severityRank > cur.properties.severityRank) seen.set(key, a);
  }
  const distinct = [...seen.values()];

  const sev = new Map<number, number>();
  const haz = new Map<HazardType, number>();
  for (const a of distinct) {
    sev.set(a.properties.severityRank, (sev.get(a.properties.severityRank) ?? 0) + 1);
    haz.set(a.properties.hazard, (haz.get(a.properties.hazard) ?? 0) + 1);
  }

  const bySeverity = [...sev.entries()]
    .map(([rank, count]) => ({
      rank,
      label: SEVERITY_LABELS[rank as 0 | 1 | 2 | 3 | 4] ?? String(rank),
      color: SEVERITY_COLORS[rank as 0 | 1 | 2 | 3 | 4] ?? "#9ca3af",
      count,
    }))
    .sort((a, b) => b.rank - a.rank);
  const byHazard = [...haz.entries()]
    .map(([hazard, count]) => {
      const m = hazardMeta(hazard);
      return { hazard, label: m.label, color: m.color, count };
    })
    .sort((a, b) => b.count - a.count);

  const volcanoCount = volcanoes.filter((v) => v.status !== "dormant").length;

  return { total: distinct.length, quakeCount: quakes.length, volcanoCount, bySeverity, byHazard };
}

export interface WorldSummary {
  /** Distinct active alerts worldwide (clustered events counted once). */
  alertTotal: number;
  /** Non-zero severity buckets, most severe first. */
  bySeverity: { rank: number; label: string; color: string; count: number }[];
  /** Quakes in the seismic feed window (USGS default ≈ last 24h). */
  quakeCount: number;
  /** Non-empty magnitude-class buckets, strongest first. */
  byMagClass: { cls: QuakeMagnitudeClass; label: string; color: string; count: number }[];
  /** Strongest quake in that window (0 if none). */
  maxMag: number;
  /** The strongest quake itself, for its place label — or null. */
  maxQuake: Quake | null;
  /** Active volcanoes worldwide (erupting + unrest only — dormant is excluded everywhere here). */
  volcanoCount: number;
  /** Non-empty status buckets (erupting/unrest), most severe first. */
  byVolcanoStatus: { status: VolcanoStatus; label: string; color: string; count: number }[];
  /** Alert + quake + volcano tally per continent, busiest first (undetectable ones dropped). */
  byContinent: {
    continent: string;
    alertCount: number;
    quakeCount: number;
    volcanoCount: number;
    total: number;
    /** This continent's alerts broken down by severity — non-zero ranks, most severe first. */
    bySeverity: { rank: number; label: string; color: string; count: number }[];
    /** This continent's quakes broken down by magnitude class, strongest first. */
    byMagClass: { cls: QuakeMagnitudeClass; label: string; color: string; count: number }[];
    /** This continent's volcanoes broken down by status, most severe first. */
    byVolcanoStatus: { status: VolcanoStatus; label: string; color: string; count: number }[];
  }[];
}

/**
 * Best-effort continent for an alert — the first area with usable geometry, via
 * the same representative-point logic the map badge/director use. Geocode-only
 * feeds with no polygon fall back on the source's known home region (NWS only
 * ever covers the US) rather than going unclassified.
 */
function alertContinent(a: Alert): string | undefined {
  const pt = alertRepPointOf(a);
  const c = pt ? continentOf(pt[0], pt[1]) : undefined;
  return c ?? (a.source === "nws" ? "North America" : undefined);
}

/**
 * The first usable [lng,lat] across an alert's areas (first geometry wins), or
 * the server's precomputed `repPoint` when the coordinates were stripped.
 *
 * The fallback is what lets World Watch run on the `omitCoordinates` feed at all:
 * this is the ONLY thing it asks the geometry, so answering it server-side turns
 * every active alert's boundary into two numbers and takes ~60% off a 19.9MB
 * payload. The route uses the same first-geometry-wins rule, so an alert lands on
 * the same continent whichever feed asked.
 */
function alertRepPointOf(a: Alert): [number, number] | null {
  for (const info of a.info ?? []) {
    for (const ar of info.area ?? []) {
      const pt = alertRepPoint(ar.geometry ?? null);
      if (pt) return pt;
    }
  }
  return a.repPoint ?? null;
}

/** Notable cities within range, nearest first — the flag/name/photo source for a
 *  feed row. Filtered to places with a real population (or capitals), same as
 *  EventNearbyPanel, so a rep point doesn't get flagged/named by some tiny
 *  unnamed hamlet that merely happens to be the closest point in the dataset. */
const NEARBY_RADIUS_KM = 350;
const MAX_NEARBY_NAMES = 2;
/** A city list, bucketed — built once per array (a feed rebuild used to
 *  re-scan the whole list for every alert, quake and volcano). Keyed on the
 *  memoised notable subset, so the crawl's flag lookups share the feed's grid. */
const cityGrids = new WeakMap<City[], GeoGrid<City>>();
function cityGrid(cities: City[]): GeoGrid<City> {
  let g = cityGrids.get(cities);
  if (!g) {
    g = new GeoGrid(cities, (c) => [c.lng, c.lat]);
    cityGrids.set(cities, g);
  }
  return g;
}
const notableGrid = (cities: City[]): GeoGrid<City> => cityGrid(notableCities(cities));

/** Widening rings for nearestNotableCity; the last spans the whole sphere (half
 *  a circumference is ~20 015 km). */
const NEAREST_RINGS_KM = [350, 1400, 5600, 20100];
/**
 * The scan itself (grid.nearby, unfiltered) memoised per list + point + radius:
 * `mode-slides.tsx` calls `eventNearbySlideHasContent` / `volcanoNearbySlideHasContent`
 * to decide whether a slide belongs in the deck, then the slide's own panel
 * (EventNearbyPanel / VolcanoNearbyPanel) asks the SAME question again to render
 * it — and both run again on every render of the segment they're attached to,
 * because `modeSlides()` isn't memoised (BroadcastFrame calls it inline; its
 * context carries 40+ fields, several rebuilt as fresh objects every render, so
 * memoising the CALL isn't a safe win — this caches its expensive inputs
 * instead). `keep` is applied fresh to the cached answer, not part of the key —
 * it's cheap (a filter over the hits, not the whole list) and call sites often
 * pass a fresh closure each render. Bounded per list so a long session cycling
 * through many segments doesn't grow this without limit.
 */
const MAX_NEARBY_SCAN_CACHE = 64;
const nearbyScanCache = new WeakMap<City[], Map<string, Nearby<City>[]>>();
function nearbyScan(cities: City[], center: [number, number], radiusKm: number): Nearby<City>[] {
  let cache = nearbyScanCache.get(cities);
  if (!cache) {
    cache = new Map();
    nearbyScanCache.set(cities, cache);
  }
  const key = `${center[0]},${center[1]},${radiusKm}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = cityGrid(cities).nearby(center, radiusKm);
    if (cache.size >= MAX_NEARBY_SCAN_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, hit);
  }
  return hit;
}
/**
 * The nearest notable city to a point with NO radius bound — the moving
 * target's "Nearest City" row, which mid-ocean still names the closest
 * landfall — or null with no cities. Exactly `nearest(notableCities(cities), …)`
 * (first of equal distances wins) without its scan: the grid is asked in
 * widening rings, and a hit inside a ring is the global nearest because
 * everything outside it is farther. That scan ran on every frame render with a
 * flight or ship on air (~130 ms of a minute on the profiler, round 26).
 */
/**
 * Cities within `radiusKm` of a point, nearest first, from the list's grid
 * (built once per array): `nearby(cities, …)` without its scan. `keep` filters
 * the answer — the notable rule, a population floor — and filtering the answer
 * is the same set in the same order as filtering the list first (ties keep
 * list order either way). The event / quake / volcano panels ran that scan on
 * every render (round 27); the scan itself is now memoised (round 29) since
 * the SAME (list, point, radius) gets asked twice per render (hasContent +
 * the panel) and again on every redundant re-render of a held segment.
 */
export function nearbyCities(
  cities: City[],
  center: [number, number],
  radiusKm: number,
  keep?: (c: City) => boolean,
): Nearby<City>[] {
  if (!cities.length) return [];
  const all = nearbyScan(cities, center, radiusKm);
  return keep ? all.filter((n) => keep(n.item)) : all;
}

/**
 * The `k` nearest cities (that `keep`) with no radius bound, nearest first —
 * `nearby(cities.filter(keep), …, 20100).slice(0, k)` without the sphere-wide
 * scan: rings widen until at least `k` qualify, and then those are the global
 * `k` nearest (everything outside the ring is farther than the k-th inside).
 */
export function nearestCities(
  cities: City[],
  center: [number, number],
  k: number,
  keep?: (c: City) => boolean,
): Nearby<City>[] {
  if (!cities.length || k <= 0) return [];
  for (const r of NEAREST_RINGS_KM) {
    const hits = nearbyCities(cities, center, r, keep);
    if (hits.length >= k || r === NEAREST_RINGS_KM[NEAREST_RINGS_KM.length - 1]) return hits.slice(0, k);
  }
  return [];
}

export function nearestNotableCity(cities: City[], point: [number, number]): Nearby<City> | null {
  if (!cities.length) return null;
  const grid = notableGrid(cities);
  for (const r of NEAREST_RINGS_KM) {
    const hit = grid.nearest(point, r);
    if (hit) return hit;
  }
  return null;
}
function nearbyPlaces(point: [number, number] | null, cities: City[]): Nearby<City>[] {
  if (!point || cities.length === 0) return [];
  return notableGrid(cities).nearby(point, NEARBY_RADIUS_KM);
}

/** "near Wichita, Topeka" from the nearest notable cities, or "" if none are close. */
function nearNamesLabel(places: Nearby<City>[]): string {
  if (!places.length) return "";
  return `near ${places.slice(0, MAX_NEARBY_NAMES).map((p) => p.item.name).join(", ")}`;
}

/** A photo for the row — the nearest notable city that actually has one (mirrors
 *  EventNearbyPanel's "featured" pick), not necessarily the single nearest place. */
function nearbyPhoto(places: Nearby<City>[]): string | undefined {
  return places.find((p) => p.item.wikiThumb)?.item.wikiThumb;
}

/**
 * Whole-planet situation summary for the always-on WORLD WATCH panel — "how many
 * active warnings, how severe, and the biggest quake" over the last day. Unlike
 * alertSummary (which works off in-view GeoJSON features), this counts the RAW
 * alerts so geocode-only warnings with no polygon still register, and de-dupes
 * cross-source clusters by keeping each group's representative (id === groupId).
 */
/** Bucket raw magnitude-class counts into the ordered (strongest-first), non-empty rows. */
function magClassRows(
  counts: Map<QuakeMagnitudeClass, number>,
): { cls: QuakeMagnitudeClass; label: string; color: string; count: number }[] {
  return QUAKE_MAGNITUDE_BANDS.filter((b) => (counts.get(b.cls) ?? 0) > 0).map((b) => ({
    cls: b.cls,
    label: b.label,
    color: QUAKE_CLASS_COLORS[b.cls],
    count: counts.get(b.cls) as number,
  }));
}

/** Same colours the globe overlay uses for volcano markers (see components/layers/volcanoes.ts). */
const VOLCANO_STATUS_META: Record<VolcanoStatus, { label: string; color: string }> = {
  erupting: { label: "Erupting", color: "#ef4444" },
  unrest: { label: "Unrest", color: "#f97316" },
  dormant: { label: "Dormant", color: "#94a3b8" },
};
/** Dormant volcanoes carry no headline — excluded from every World Watch count. */
const ACTIVE_VOLCANO_STATUSES: VolcanoStatus[] = ["erupting", "unrest"];

/** Bucket raw volcano-status counts into the ordered (most severe first), non-empty rows. */
function volcanoStatusRows(
  counts: Map<VolcanoStatus, number>,
): { status: VolcanoStatus; label: string; color: string; count: number }[] {
  return ACTIVE_VOLCANO_STATUSES.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({
    status: s,
    label: VOLCANO_STATUS_META[s].label,
    color: VOLCANO_STATUS_META[s].color,
    count: counts.get(s) as number,
  }));
}

export function worldWatchSummary(alerts: Alert[], quakes: Quake[], volcanoes: Volcano[] = []): WorldSummary {
  const activeVolcanoes = volcanoes.filter((v) => v.status !== "dormant");
  // One row per clustered event (a warning carried by both WMO + MeteoAlarm
  // counts once); alerts the API didn't group have no groupId and pass through.
  const distinct = alerts.filter((a) => !a.groupId || a.id === a.groupId);

  const sev = new Map<number, number>();
  for (const a of distinct) sev.set(a.maxSeverityRank, (sev.get(a.maxSeverityRank) ?? 0) + 1);
  const bySeverity = [...sev.entries()]
    .filter(([rank]) => rank > 0) // drop None/info from the severity breakdown
    .map(([rank, count]) => ({
      rank,
      label: SEVERITY_LABELS[rank as 0 | 1 | 2 | 3 | 4] ?? String(rank),
      color: SEVERITY_COLORS[rank as 0 | 1 | 2 | 3 | 4] ?? "#9ca3af",
      count,
    }))
    .sort((a, b) => b.rank - a.rank);

  const magCounts = new Map<QuakeMagnitudeClass, number>();
  for (const q of quakes) {
    const cls = quakeMagnitudeClass(q.mag);
    magCounts.set(cls, (magCounts.get(cls) ?? 0) + 1);
  }
  const byMagClass = magClassRows(magCounts);

  let maxQuake: Quake | null = null;
  for (const q of quakes) if (!maxQuake || q.mag > maxQuake.mag) maxQuake = q;

  const volcanoCounts = new Map<VolcanoStatus, number>();
  for (const v of activeVolcanoes) volcanoCounts.set(v.status, (volcanoCounts.get(v.status) ?? 0) + 1);
  const byVolcanoStatus = volcanoStatusRows(volcanoCounts);

  const cont = new Map<
    string,
    {
      alertCount: number;
      quakeCount: number;
      volcanoCount: number;
      sev: Map<number, number>;
      mag: Map<QuakeMagnitudeClass, number>;
      volc: Map<VolcanoStatus, number>;
    }
  >();
  const contOf = (continent: string) => {
    const cur =
      cont.get(continent) ??
      {
        alertCount: 0,
        quakeCount: 0,
        volcanoCount: 0,
        sev: new Map<number, number>(),
        mag: new Map<QuakeMagnitudeClass, number>(),
        volc: new Map<VolcanoStatus, number>(),
      };
    cont.set(continent, cur);
    return cur;
  };
  for (const a of distinct) {
    const c = alertContinent(a);
    if (!c) continue;
    const cur = contOf(c);
    cur.alertCount += 1;
    cur.sev.set(a.maxSeverityRank, (cur.sev.get(a.maxSeverityRank) ?? 0) + 1);
  }
  for (const q of quakes) {
    const c = continentOf(q.lng, q.lat);
    if (!c) continue;
    const cur = contOf(c);
    cur.quakeCount += 1;
    const cls = quakeMagnitudeClass(q.mag);
    cur.mag.set(cls, (cur.mag.get(cls) ?? 0) + 1);
  }
  for (const v of activeVolcanoes) {
    const c = continentOf(v.lng, v.lat);
    if (!c) continue;
    const cur = contOf(c);
    cur.volcanoCount += 1;
    cur.volc.set(v.status, (cur.volc.get(v.status) ?? 0) + 1);
  }
  const byContinent = [...cont.entries()]
    .map(([continent, v]) => ({
      continent,
      alertCount: v.alertCount,
      quakeCount: v.quakeCount,
      volcanoCount: v.volcanoCount,
      total: v.alertCount + v.quakeCount + v.volcanoCount,
      // Per-continent severity mix — same rank→label/colour mapping as the
      // panel-wide breakdown, so a busy continent's bar reads by severity
      // instead of a flat "how many alerts" blob.
      bySeverity: [...v.sev.entries()]
        .filter(([rank]) => rank > 0)
        .map(([rank, count]) => ({
          rank,
          label: SEVERITY_LABELS[rank as 0 | 1 | 2 | 3 | 4] ?? String(rank),
          color: SEVERITY_COLORS[rank as 0 | 1 | 2 | 3 | 4] ?? "#9ca3af",
          count,
        }))
        .sort((a, b) => b.rank - a.rank),
      byMagClass: magClassRows(v.mag),
      byVolcanoStatus: volcanoStatusRows(v.volc),
    }))
    .sort((x, y) => y.total - x.total);

  return {
    alertTotal: distinct.length,
    bySeverity,
    quakeCount: quakes.length,
    byMagClass,
    maxMag: maxQuake?.mag ?? 0,
    maxQuake,
    volcanoCount: activeVolcanoes.length,
    byVolcanoStatus,
    byContinent,
  };
}

/** One line in the always-on WORLD WATCH feed — an alert, a quake, or a volcano. */
export interface WorldWatchItem {
  key: string;
  kind: "alert" | "quake" | "volcano";
  /** Severity colour (alerts), magnitude colour (quakes), or status colour (volcanoes). */
  color: string;
  /** Bold lead chip — "SEVERE" / "M6.3" / "ERUPTING". */
  tag: string;
  /** Which vector mark identifies the row — a hazard from the shared vocabulary,
   *  or the fixed seismic mark for quakes. NOT an emoji: the encoder's Chromium
   *  has no emoji font, so WorldFeed draws this through <HazardGlyph>. */
  glyph: HazardType | "quake";
  /** Nearest enriched city's flag within range, "" if none close enough to trust. */
  flag: string;
  /** Wikipedia thumbnail of the nearest enriched city that has one, if any. */
  photo?: string;
  /** Main line — the hazard event or the quake's place. */
  title: string;
  /** Subtitle — the area (+ "near City, City" if any are close), or "TSUNAMI POTENTIAL". */
  sub: string;
  /** "in 42m" / "expired" countdown for alerts, undefined for quakes / no expiry. */
  expiresIn?: string;
  /** Sort weight, higher = shown first. */
  weight: number;
  /** Epoch ms tie-breaker (alert `sent` / quake `time`) — newer first within equal weight. */
  sortTime: number;
}

/**
 * Magnitude → the same 0-4 importance scale alerts use, so the feed interleaves,
 * but continuous *within* a tier (not just floor(mag)) so e.g. M4.9 outranks
 * M4.5 instead of tying — ties used to fall back to arrival order, which is why
 * the feed looked shuffled among same-tier quakes. The top tier (M7+) stays flat
 * at exactly 4 so it still ties with (and loses to) Extreme alerts rather than
 * creeping past them.
 */
function quakeWeight(mag: number): number {
  if (mag >= 7) return 4;
  if (mag >= 6) return 3 + Math.min(0.99, mag - 6);
  if (mag >= 5) return 2 + Math.min(0.99, mag - 5);
  return 1 + Math.min(0.99, (mag - 4.5) / 0.5);
}

/** Colour a quake by magnitude (matches the SEISMIC row: orange for the big ones). */
function quakeColor(mag: number): string {
  if (mag >= 7) return "#ef4444";
  if (mag >= 6) return "#f97316";
  if (mag >= 5) return "#facc15";
  return "#43d9ff";
}


/** Status → the same importance scale quakeWeight uses — erupting rides near the
 *  top of the Extreme/M6+ tier, unrest sits around Moderate/M5. Dormant never
 *  reaches here (filtered out before this is called). */
function volcanoWeight(status: VolcanoStatus): number {
  return status === "erupting" ? 3.5 : 2;
}

/** Colour a volcano row by status — same palette as the globe overlay markers. */
function volcanoColor(status: VolcanoStatus): string {
  return VOLCANO_STATUS_META[status].color;
}

/**
 * The full whole-planet feed the always-on WORLD WATCH panel scrolls through —
 * every active alert (clustered events counted once, like worldWatchSummary),
 * every quake in the ~24h window, and every erupting/unrest volcano — merged and
 * sorted most-serious first so a big quake or fresh eruption rides above minor
 * warnings. No cap: the panel marquees the whole list.
 *
 * `cities` (the same curated, wiki-enriched set the "near this event" panel
 * uses) is optional and purely cosmetic: when given, each row gets the flag,
 * up to two named nearby places, and a photo (if one of them has a Wikipedia
 * thumbnail) from whatever's within NEARBY_RADIUS_KM — so the feed reads at a
 * glance without a fresh network call.
 */
export function worldWatchFeed(
  alerts: Alert[],
  quakes: Quake[],
  cities: City[] = [],
  volcanoes: Volcano[] = [],
): WorldWatchItem[] {
  const distinct = alerts.filter((a) => !a.groupId || a.id === a.groupId);
  const items: WorldWatchItem[] = [];

  for (const a of distinct) {
    const rank = a.maxSeverityRank;
    const info = primaryInfo(a);
    const area = areaSummary(a);
    const hazard = classifyHazard({ event: info?.event, translatedEvent: info?.translatedHeadline, parameters: info?.parameters });
    const places = nearbyPlaces(alertRepPointOf(a), cities);
    const sub = [area === "—" ? "" : area, nearNamesLabel(places)].filter(Boolean).join(" · ");
    items.push({
      key: `a:${a.id}`,
      kind: "alert",
      color: SEVERITY_COLORS[rank] ?? "#9ca3af",
      tag: (SEVERITY_LABELS[rank] ?? "ALERT").toUpperCase(),
      glyph: hazard,
      flag: places[0] ? isoToFlag(places[0].item.cc) : "",
      photo: nearbyPhoto(places),
      title: broadcastEventLabel({
        hazard,
        severityRank: rank,
        event: info?.event,
        translatedEvent: info?.translatedHeadline,
      }),
      sub,
      expiresIn: a.expiresAt ? expiresLabel(a) : undefined,
      weight: rank,
      sortTime: Date.parse(a.sent) || 0,
    });
  }

  for (const q of quakes) {
    const places = nearbyPlaces([q.lng, q.lat], cities);
    const sub = [q.tsunami ? "TSUNAMI POTENTIAL" : "", nearNamesLabel(places)].filter(Boolean).join(" · ");
    items.push({
      key: `q:${q.id}`,
      kind: "quake",
      color: quakeColor(q.mag),
      tag: `M${q.mag.toFixed(1)}`,
      glyph: "quake",
      flag: places[0] ? isoToFlag(places[0].item.cc) : "",
      photo: nearbyPhoto(places),
      title: q.place ?? `${q.lat.toFixed(1)}, ${q.lng.toFixed(1)}`,
      sub,
      weight: quakeWeight(q.mag),
      sortTime: q.time,
    });
  }

  for (const v of volcanoes) {
    if (v.status === "dormant") continue;
    const places = nearbyPlaces([v.lng, v.lat], cities);
    const sub = [v.country ?? "", nearNamesLabel(places)].filter(Boolean).join(" · ");
    items.push({
      key: `v:${v.id}`,
      kind: "volcano",
      color: volcanoColor(v.status),
      tag: VOLCANO_STATUS_META[v.status].label.toUpperCase(),
      glyph: "volcano",
      flag: places[0] ? isoToFlag(places[0].item.cc) : "",
      photo: v.wikiThumb ?? nearbyPhoto(places),
      title: v.name,
      sub,
      weight: volcanoWeight(v.status),
      sortTime: v.lastDate,
    });
  }

  // Most serious first (weight, now continuous within a tier so e.g. M4.9 beats
  // M4.5 instead of tying); on a weight tie, group by kind, then newest first.
  return items.sort(
    (a, b) =>
      b.weight - a.weight ||
      (a.kind === b.kind ? 0 : a.kind === "alert" ? -1 : 1) ||
      b.sortTime - a.sortTime,
  );
}

/** The feed rows of a single event kind — for the per-category WORLD REPORT
 *  deck slides (ALERTS / SEISMIC / VOLCANOES each show only their own kind).
 *  Order is preserved, so rows stay most-serious-first per worldWatchFeed. */
export function filterFeedByKind(
  feed: WorldWatchItem[],
  kind: WorldWatchItem["kind"],
): WorldWatchItem[] {
  return feed.filter((item) => item.kind === kind);
}

/** Raw areaDesc if the source gave one, else the nearest notable city/cities —
 *  same fallback worldWatchFeed already uses so the two on-air panels agree. */
export function alertAreaLabel(a: AlertFeature, cities: City[] = []): string {
  if (a.properties.areaDesc) return a.properties.areaDesc;
  const places = nearbyPlaces(alertRepPoint(a.geometry), cities);
  return nearNamesLabel(places);
}

/** Cap a label at `max` chars, cutting on a word boundary and adding an ellipsis. */
function clampLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** "Tsunami Watch: Fiji Region — YELLOW" for the live-alert panel body. The
 *  hazard name comes from the broadcast phrasebook, not the source bulletin.
 *  Event + area are each length-capped so the panel never overflows on alerts
 *  with sprawling areaDesc lists; the severity suffix is always kept intact. */
export function alertBannerText(a: AlertFeature, cities: City[] = []): string {
  const p = a.properties;
  const event = clampLabel(alertLabel(p), 48);
  const areaText = clampLabel(alertAreaLabel(a, cities), 40);
  const area = areaText ? `: ${areaText}` : "";
  const level = p.level ?? SEVERITY_LABELS[p.severityRank];
  return `${event}${area}${level ? ` — ${level.toUpperCase()}` : ""}`;
}
