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
import { nearby, type Nearby } from "./geo";
import type { City } from "./cities";

/** "SEISMIC M5.9 · 12km SSW of … · TSUNAMI POTENTIAL" */
export function quakeTicker(q: Quake): string {
  const loc = q.place ?? `${q.lat.toFixed(1)}, ${q.lng.toFixed(1)}`;
  return `SEISMIC M${q.mag.toFixed(1)} · ${loc}${q.tsunami ? " · TSUNAMI POTENTIAL" : ""}`;
}

/** "TSUNAMI WATCH: Fiji Region" (severity-prefixed hazard + area). */
export function alertTicker(a: AlertFeature): string {
  const p = a.properties;
  const sev = SEVERITY_LABELS[p.severityRank];
  const area = p.areaDesc ? ` · ${p.areaDesc}` : "";
  return `${sev ? `${sev.toUpperCase()}: ` : ""}${p.event}${area}`;
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

export interface AreaSummary {
  /** Distinct active alerts in view (de-duped by area + hazard). */
  total: number;
  /** Active earthquakes in view. */
  quakeCount: number;
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
export function alertSummary(alerts: AlertFeature[], quakes: Quake[] = []): AreaSummary {
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

  return { total: distinct.length, quakeCount: quakes.length, bySeverity, byHazard };
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
  /** Alert + quake tally per continent, busiest first (undetectable ones dropped). */
  byContinent: {
    continent: string;
    alertCount: number;
    quakeCount: number;
    total: number;
    /** This continent's alerts broken down by severity — non-zero ranks, most severe first. */
    bySeverity: { rank: number; label: string; color: string; count: number }[];
    /** This continent's quakes broken down by magnitude class, strongest first. */
    byMagClass: { cls: QuakeMagnitudeClass; label: string; color: string; count: number }[];
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

export function worldWatchSummary(alerts: Alert[], quakes: Quake[]): WorldSummary {
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

  const cont = new Map<
    string,
    { alertCount: number; quakeCount: number; sev: Map<number, number>; mag: Map<QuakeMagnitudeClass, number> }
  >();
  const contOf = (continent: string) => {
    const cur =
      cont.get(continent) ??
      { alertCount: 0, quakeCount: 0, sev: new Map<number, number>(), mag: new Map<QuakeMagnitudeClass, number>() };
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
  const byContinent = [...cont.entries()]
    .map(([continent, v]) => ({
      continent,
      alertCount: v.alertCount,
      quakeCount: v.quakeCount,
      total: v.alertCount + v.quakeCount,
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
    }))
    .sort((x, y) => y.total - x.total);

  return {
    alertTotal: distinct.length,
    bySeverity,
    quakeCount: quakes.length,
    byMagClass,
    maxMag: maxQuake?.mag ?? 0,
    maxQuake,
    byContinent,
  };
}

/** One line in the always-on WORLD WATCH feed — an alert or a quake. */
export interface WorldWatchItem {
  key: string;
  kind: "alert" | "quake";
  /** Severity colour (alerts) or magnitude colour (quakes). */
  color: string;
  /** Bold lead chip — "SEVERE" / "M6.3". */
  tag: string;
  /** Hazard glyph (alerts) or a seismic glyph (quakes) — from the shared hazard vocabulary. */
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
}

/** Magnitude → the same 0-4 importance scale alerts use, so the feed interleaves. */
function quakeWeight(mag: number): number {
  if (mag >= 7) return 4;
  if (mag >= 6) return 3;
  if (mag >= 5) return 2;
  return 1;
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

/**
 * The full whole-planet feed the always-on WORLD WATCH panel scrolls through —
 * every active alert (clustered events counted once, like worldWatchSummary) plus
 * every quake in the ~24h window, merged and sorted most-serious first so a big
 * quake rides above minor warnings. No cap: the panel marquees the whole list.
 *
 * `cities` (the same curated, wiki-enriched set the "near this event" panel
 * uses) is optional and purely cosmetic: when given, each row gets the flag,
 * up to two named nearby places, and a photo (if one of them has a Wikipedia
 * thumbnail) from whatever's within NEARBY_RADIUS_KM — so the feed reads at a
 * glance without a fresh network call.
 */
export function worldWatchFeed(alerts: Alert[], quakes: Quake[], cities: City[] = []): WorldWatchItem[] {
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
      title: info?.event ?? "Alert",
      sub,
      expiresIn: a.expiresAt ? expiresLabel(a) : undefined,
      weight: rank,
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
    });
  }

  // Most serious first; on a tie surface alerts before quakes for a stable order.
  return items.sort(
    (a, b) => b.weight - a.weight || (a.kind === b.kind ? 0 : a.kind === "alert" ? -1 : 1),
  );
}

/** "Tsunami Watch: Fiji Region — YELLOW" for the live-alert panel body. */
export function alertBannerText(a: AlertFeature): string {
  const p = a.properties;
  const area = p.areaDesc ? `: ${p.areaDesc}` : "";
  const level = p.level ?? SEVERITY_LABELS[p.severityRank];
  return `${p.event}${area}${level ? ` — ${level.toUpperCase()}` : ""}`;
}
