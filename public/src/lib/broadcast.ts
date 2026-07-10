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
import { isoToFlag } from "@photonsurge/shared/tracks/flags";
import { nearby, withinBbox, type Nearby } from "./geo";
import type { City } from "./cities";
import type { Volcano, VolcanoStatus } from "@photonsurge/shared/volcanoes/types";

/** "SEISMIC M5.9 · 12km SSW of … · TSUNAMI POTENTIAL" */
export function quakeTicker(q: Quake): string {
  const loc = q.place ?? `${q.lat.toFixed(1)}, ${q.lng.toFixed(1)}`;
  return `SEISMIC M${q.mag.toFixed(1)} · ${loc}${q.tsunami ? " · TSUNAMI POTENTIAL" : ""}`;
}

/** "TSUNAMI WATCH: Fiji Region" (severity-prefixed hazard + area). Prefers the
 *  English translation of the event/headline when the source isn't English. */
export function alertTicker(a: AlertFeature): string {
  const p = a.properties;
  const sev = SEVERITY_LABELS[p.severityRank];
  const area = p.areaDesc ? ` · ${p.areaDesc}` : "";
  const event = p.translatedHeadline || p.event;
  return `${sev ? `${sev.toUpperCase()}: ` : ""}${event}${area}`;
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
 * All ticker lines from the live data, seismic → alerts → tracks. Alerts are
 * de-duped by area first (kills the multi-language repeats); no cap otherwise —
 * the crawl shows everything (long feeds just scroll longer).
 */
export function buildTicker(input: {
  alerts?: AlertFeature[];
  quakes?: Quake[];
  tracks?: Track[];
}): string[] {
  const items: string[] = [];
  for (const q of input.quakes ?? []) items.push(quakeTicker(q));
  for (const a of dedupeAlerts(input.alerts ?? [])) items.push(alertTicker(a));
  for (const t of input.tracks ?? []) items.push(trackTicker(t));
  return [...new Set(items)];
}

/** Active alerts, de-duped by area and sorted most-severe first — the full list. */
export function sortedAlerts(alerts: AlertFeature[]): AlertFeature[] {
  return dedupeAlerts(alerts).sort(
    (a, b) => b.properties.severityRank - a.properties.severityRank,
  );
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
  byHazard: { hazard: HazardType; label: string; icon: string; color: string; count: number }[];
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
      return { hazard, label: m.label, icon: m.icon, color: m.color, count };
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

/** The first usable [lng,lat] across an alert's areas (first geometry wins). */
function alertRepPointOf(a: Alert): [number, number] | null {
  for (const info of a.info ?? []) {
    for (const ar of info.area ?? []) {
      const pt = alertRepPoint(ar.geometry ?? null);
      if (pt) return pt;
    }
  }
  return null;
}

/** Notable cities within range, nearest first — the flag/name/photo source for a
 *  feed row. Filtered to places with a real population (or capitals), same as
 *  EventNearbyPanel, so a rep point doesn't get flagged/named by some tiny
 *  unnamed hamlet that merely happens to be the closest point in the dataset. */
const NEARBY_RADIUS_KM = 350;
const MAX_NEARBY_NAMES = 2;
function nearbyPlaces(point: [number, number] | null, cities: City[]): Nearby<City>[] {
  if (!point || cities.length === 0) return [];
  const notable = cities.filter((c) => (c.population ?? 0) > 0 || c.isCapital);
  return nearby(notable, point, (c) => [c.lng, c.lat], NEARBY_RADIUS_KM);
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
  /** Hazard glyph — from the shared hazard vocabulary (a fixed seismic glyph for quakes). */
  icon: string;
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

/** No dedicated hazard category for seismic activity — one fixed glyph for every quake row. */
const QUAKE_ICON = "🌎";

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
    const hazard = classifyHazard({ event: info?.event, parameters: info?.parameters });
    const places = nearbyPlaces(alertRepPointOf(a), cities);
    const sub = [area === "—" ? "" : area, nearNamesLabel(places)].filter(Boolean).join(" · ");
    items.push({
      key: `a:${a.id}`,
      kind: "alert",
      color: SEVERITY_COLORS[rank] ?? "#9ca3af",
      tag: (SEVERITY_LABELS[rank] ?? "ALERT").toUpperCase(),
      icon: hazardMeta(hazard).icon,
      flag: places[0] ? isoToFlag(places[0].item.cc) : "",
      photo: nearbyPhoto(places),
      title: info?.translatedHeadline || info?.event || "Alert",
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
      icon: QUAKE_ICON,
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
      icon: hazardMeta("volcano").icon,
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

/** "Tsunami Watch: Fiji Region — YELLOW" for the live-alert panel body. Prefers
 *  the English translation of the headline when the source alert isn't English. */
export function alertBannerText(a: AlertFeature, cities: City[] = []): string {
  const p = a.properties;
  const event = p.translatedHeadline || p.event;
  const areaText = alertAreaLabel(a, cities);
  const area = areaText ? `: ${areaText}` : "";
  const level = p.level ?? SEVERITY_LABELS[p.severityRank];
  return `${event}${area}${level ? ` — ${level.toUpperCase()}` : ""}`;
}
