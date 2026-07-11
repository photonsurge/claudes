/**
 * Per-place round-up input aggregation: reduce everything currently happening
 * inside ONE country or region to the deterministic fact-set the LLM writes
 * from — the biggest cities' conditions (+ the capital, always), the
 * area-weather aggregate, every active alert and active volcano whose footprint
 * falls inside the place, and the nearest cached tide/seismograph gauge
 * readings. Pure geo helpers (`inBbox`, `bboxCenter`) are unit-tested; the
 * scoping is bbox for regions, bbox + real-boundary polygon mask for countries.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { pointInPolygon, type SimpleGeometry } from "@photonsurge/shared/geo/pointInPolygon";
import type {
  PlaceRoundupKind,
  iPlaceRoundupInputs,
  iRoundupCity,
  iRoundupAlert,
  iRoundupVolcano,
  iRoundupGauge,
} from "@photonsurge/shared/db/place-roundup-model";
import { alertCentroid } from "../summaries/aggregate";

/** Round-up cadence, in hours — the window each 12h call narrates. */
export const WINDOW_HOURS = 12;

/** How many population-ranked cities to feed the model (the capital is added on top when missing). */
const TOP_CITIES = 10;

export interface PlaceRef {
  kind: PlaceRoundupKind;
  /** countryId / regionId. */
  id: string;
  name: string;
  bbox: [number, number, number, number];
  /** Country real boundary for an exact mask; absent for regions (bbox only). */
  geometry?: SimpleGeometry | null;
  /** ISO-3166 alpha-2 (countries) — scopes cities by `cc` for accuracy over bbox. */
  iso2?: string;
  /** Capital city name (countries) — always surfaced in the city list. */
  capital?: string;
}

type Bbox = [number, number, number, number];

/** PURE: is [lng,lat] inside `bbox` ([w,s,e,n]), handling an antimeridian-wrapping box (w > e). */
export function inBbox(lng: number, lat: number, bbox: Bbox): boolean {
  const [w, s, e, n] = bbox;
  if (lat < s || lat > n) return false;
  return w <= e ? lng >= w && lng <= e : lng >= w || lng <= e;
}

/** PURE: bbox centre + a radius (km) covering it, for the nearest-gauge query. Antimeridian-aware. */
export function bboxCenter(bbox: Bbox): { lng: number; lat: number; radiusKm: number } {
  const [w, s, e, n] = bbox;
  const lat = (s + n) / 2;
  // Wrapping box: span crosses ±180, so the centre sits on the far side.
  const width = w <= e ? e - w : 360 - w + e;
  let lng = w <= e ? (w + e) / 2 : w + width / 2;
  if (lng > 180) lng -= 360;
  // Rough half-diagonal in km (111 km/deg), floored so tiny places still reach a gauge.
  const spanDeg = Math.max(width, n - s);
  const radiusKm = Math.max(150, (spanDeg / 2) * 111 * 1.2);
  return { lng, lat, radiusKm };
}

/** Point-in-place test: bbox for regions, bbox AND polygon for countries. */
function makeInPlace(place: PlaceRef): (lng: number, lat: number) => boolean {
  const geom = place.geometry;
  return (lng, lat) => {
    if (!inBbox(lng, lat, place.bbox)) return false;
    if (geom) return pointInPolygon(lng, lat, geom);
    return true;
  };
}

/** The biggest cities inside the place with their cached current conditions, capital always included. */
async function scopedCities(db: AppDb, place: PlaceRef): Promise<iRoundupCity[]> {
  // Over-fetch so a country's capital / top cities survive the cc filter below.
  const raw = await db.cityWeather.topByBbox(place.bbox, 60);
  const iso2 = place.iso2?.toLowerCase();
  // Countries: trust the city `cc` over the bbox (an archipelago's bbox catches
  // neighbours). Regions: bbox is the definition, keep everything.
  const inCountry = iso2 ? raw.filter((c) => (c.cc ?? "").toLowerCase() === iso2) : raw;
  const pool = inCountry.length ? inCountry : raw;

  const capital = place.capital?.trim().toLowerCase();
  const toCity = (c: (typeof pool)[number]): iRoundupCity => ({
    name: c.name,
    cc: c.cc,
    lat: c.lat,
    lng: c.lng,
    population: c.population,
    isCapital: !!capital && c.name.trim().toLowerCase() === capital,
    temp: c.current?.temp,
    wind: c.current?.wind,
    rain: c.current?.rain,
    hi: c.daily?.[0]?.hi,
    lo: c.daily?.[0]?.lo,
  });

  const top = pool.slice(0, TOP_CITIES).map(toCity);
  // Capital escaped the top-N cut but is in the pool → surface it anyway.
  if (capital && !top.some((c) => c.isCapital)) {
    const cap = pool.find((c) => c.name.trim().toLowerCase() === capital);
    if (cap) top.push(toCity(cap));
  }
  return top;
}

/** Active alerts whose footprint centroid falls inside the place. */
async function scopedAlerts(db: AppDb, inPlace: (lng: number, lat: number) => boolean): Promise<iRoundupAlert[]> {
  const alerts = await db.alerts.list({ activeOnly: true });
  const out: iRoundupAlert[] = [];
  for (const a of alerts) {
    const c = alertCentroid(a);
    if (!c || !inPlace(c.lng, c.lat)) continue;
    const info = a.info?.[0];
    out.push({
      event: info?.event || a.identifier,
      headline: info?.headline || undefined,
      severityRank: (a.maxSeverityRank ?? 0) as number,
      hazard: classifyHazard({ event: info?.event, parameters: info?.parameters }),
      onset: info?.onset || a.sent || undefined,
      source: a.source,
      lng: c.lng,
      lat: c.lat,
    });
  }
  out.sort((x, y) => y.severityRank - x.severityRank);
  return out;
}

/** Active (erupting/unrest) volcanoes inside the place. */
async function scopedVolcanoes(db: AppDb, inPlace: (lng: number, lat: number) => boolean): Promise<iRoundupVolcano[]> {
  const volcanoes = await db.volcanoes.list().catch(() => []);
  return volcanoes
    .filter((v) => v.status !== "dormant" && inPlace(v.lng, v.lat))
    .map((v) => ({ name: v.name, status: v.status, lng: v.lng, lat: v.lat }));
}

/** Nearest cached tide + seismograph gauges to the place centre, clipped to its bbox. */
async function scopedGauges(
  db: AppDb,
  place: PlaceRef,
): Promise<{ tideGauges: iRoundupGauge[]; seismoStations: iRoundupGauge[] }> {
  const { lng, lat, radiusKm } = bboxCenter(place.bbox);
  const [tides, seismo] = await Promise.all([
    db.tideSeries.nearMany({ lng, lat, maxKm: radiusKm, limit: 8 }).catch(() => []),
    db.seismoSeries.nearMany({ lng, lat, maxKm: radiusKm, limit: 8 }).catch(() => []),
  ]);
  const tideGauges = tides
    .filter((t) => inBbox(t.series.lng, t.series.lat, place.bbox))
    .map((t) => ({ name: t.series.name, latest: t.series.latest, distanceKm: Math.round(t.distanceKm) }));
  const seismoStations = seismo
    .filter((s) => inBbox(s.series.lng, s.series.lat, place.bbox))
    .map((s) => ({
      name: s.series.siteName || `${s.series.net}.${s.series.sta}`,
      latest: s.series.latest,
      distanceKm: Math.round(s.distanceKm),
    }));
  return { tideGauges, seismoStations };
}

/** Assemble the full input snapshot for one place — everything the LLM sees. */
export async function buildPlaceInputs(db: AppDb, place: PlaceRef): Promise<iPlaceRoundupInputs> {
  const inPlace = makeInPlace(place);
  const [topCities, area, alerts, volcanoes, gauges] = await Promise.all([
    scopedCities(db, place),
    db.areaWeatherReports.latest(place.kind, place.id).catch(() => null),
    scopedAlerts(db, inPlace),
    scopedVolcanoes(db, inPlace),
    scopedGauges(db, place),
  ]);
  return {
    topCities,
    area: area ? { stats: area.stats, hazards: area.hazards } : null,
    alerts,
    volcanoes,
    tideGauges: gauges.tideGauges,
    seismoStations: gauges.seismoStations,
  };
}
