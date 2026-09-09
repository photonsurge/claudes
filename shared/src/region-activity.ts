/**
 * Live region activity — the "easy object" a region dossier needs: the active
 * alerts, recent earthquakes and restless volcanoes WITHIN a region, right now.
 * Computed at read time (these are time-varying — storing them would go stale),
 * so both the /regions/[id] admin page and broadcast slides call this same helper.
 *
 * Membership-refined, NOT bbox-alone: the region bbox is a cheap spatial
 * pre-filter (geo-indexed in each repo), then POINT events (quakes/volcanoes) are
 * kept only if they fall in a member country — otherwise a neighbour's quake
 * sitting inside the frame would leak in. Alerts are areas (not points), so the
 * repo's geometry-intersect against the bbox stands.
 */
import type { AppDb } from "./db/index";
import { memberCountryCodes } from "./region-membership";
import { countryBboxContaining } from "./countries";
import { quakeLiveWindowSince } from "./seismic";

export interface RegionAlertItem {
  id: string;
  event?: string;
  headline?: string;
  severity: number;
  area?: string;
}
export interface RegionQuakeItem {
  id: string;
  mag: number;
  place?: string;
  time: Date;
  lat: number;
  lng: number;
}
export interface RegionVolcanoItem {
  id: string;
  name: string;
  status: string;
  country?: string;
  lat: number;
  lng: number;
}

export interface RegionActivity {
  alerts: { count: number; maxSeverity: number; items: RegionAlertItem[] };
  seismic: { count: number; maxMag: number; items: RegionQuakeItem[] };
  volcanic: { count: number; items: RegionVolcanoItem[] };
}

/** A point is "in" the region if it sits in one of its member countries. */
function inMembers(lng: number, lat: number, members: Set<string>): boolean {
  if (members.size === 0) return false;
  const c = countryBboxContaining(lng, lat);
  return !!c && members.has(c.id);
}

export async function regionActivity(
  db: AppDb,
  region: { regionId: string; bbox: [number, number, number, number] },
  countries: { iso2?: string; continent?: string }[],
): Promise<RegionActivity> {
  const members = new Set(memberCountryCodes(region.regionId, countries));

  const [alerts, quakes, volcanoes] = await Promise.all([
    db.alerts.list({ activeOnly: true, bbox: region.bbox }),
    // Live window only (shared/seismic) — this panel answers "what is
    // happening in this area now", and the collection retains ~a month.
    db.quakes.list({ bbox: region.bbox, sinceMs: quakeLiveWindowSince() }),
    db.volcanoes.list({ bbox: region.bbox }),
  ]);

  const alertItems: RegionAlertItem[] = alerts
    .map((a) => {
      const info = a.info?.[0];
      return {
        id: a.id,
        event: info?.event,
        headline: info?.headline,
        severity: a.maxSeverityRank ?? 0,
        area: info?.area?.[0]?.areaDesc,
      };
    })
    .sort((x, y) => y.severity - x.severity);

  const quakeItems: RegionQuakeItem[] = quakes
    .filter((q) => inMembers(q.lng, q.lat, members))
    .map((q) => ({ id: q.quakeId, mag: q.mag, place: q.place, time: q.time, lat: q.lat, lng: q.lng }))
    .sort((x, y) => y.mag - x.mag);

  const volcanoItems: RegionVolcanoItem[] = volcanoes
    .filter((v) => inMembers(v.lng, v.lat, members))
    .map((v) => ({ id: v.id, name: v.name, status: v.status, country: v.country, lat: v.lat, lng: v.lng }));

  return {
    alerts: {
      count: alertItems.length,
      maxSeverity: alertItems.reduce((m, a) => Math.max(m, a.severity), 0),
      items: alertItems,
    },
    seismic: {
      count: quakeItems.length,
      maxMag: quakeItems.reduce((m, q) => Math.max(m, q.mag), 0),
      items: quakeItems,
    },
    volcanic: { count: volcanoItems.length, items: volcanoItems },
  };
}
