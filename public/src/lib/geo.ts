/**
 * PURE geospatial helpers for the broadcast overlays — "what's near this event".
 * Used to pick the cities and webcams around an on-air alert/quake so the event
 * card can show who's affected. No DOM, no network: fully unit-testable.
 */

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km between two [lng, lat] points (haversine). */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface Nearby<T> {
  item: T;
  distanceKm: number;
}

/**
 * Items within `radiusKm` of `center` ([lng,lat]), nearest first. `getPoint`
 * pulls each item's [lng,lat] (return null to skip an item with no location).
 * No count cap — the radius is the limiter, so nothing is silently dropped.
 */
export function nearby<T>(
  items: T[],
  center: [number, number],
  getPoint: (item: T) => [number, number] | null,
  radiusKm: number,
): Nearby<T>[] {
  const out: Nearby<T>[] = [];
  // Reject the vast majority of items with two subtractions before any trig:
  // on the 15k-city set a scan is ~15k haversines otherwise, and the slide-deck
  // memo runs one per rebuild — 47 ms inside a cut on the profiler.
  const box = radiusBox(center, radiusKm);
  for (const item of items) {
    const p = getPoint(item);
    if (!p || !withinRadiusBox(center, p, box)) continue;
    const distanceKm = haversineKm(center, p);
    if (distanceKm <= radiusKm) out.push({ item, distanceKm });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out;
}

/** Kilometres per degree of latitude on the haversine sphere (~111.2). */
const KM_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_KM;

/** Half-extents (degrees) of a lat/lng box around a centre. */
export interface RadiusBox {
  dLat: number;
  dLng: number;
}

/**
 * A lat/lng box that contains EVERY point within `radiusKm` of `center` on the
 * haversine sphere — a cheap pre-cull, never a substitute for the distance
 * check. Latitude: the radius in degrees. Longitude: measured at the box's
 * pole-ward edge, where the parallels are shortest, so it over-covers rather
 * than under-covers at high latitude (plus a hair of slack for rounding); a box
 * that reaches a pole spans every longitude.
 */
export function radiusBox(center: [number, number], radiusKm: number): RadiusBox {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const edgeLat = Math.abs(center[1]) + dLat;
  if (edgeLat >= 89.9) return { dLat, dLng: 180 };
  return { dLat, dLng: Math.min(180, (dLat / Math.cos(toRad(edgeLat))) * 1.001) };
}

/** True if `p` ([lng, lat]) lies inside the box around `center`, dateline-aware. */
export function withinRadiusBox(center: [number, number], p: [number, number], box: RadiusBox): boolean {
  if (Math.abs(p[1] - center[1]) > box.dLat) return false;
  let dLng = Math.abs(p[0] - center[0]);
  if (dLng > 180) dLng = 360 - dLng;
  return dLng <= box.dLng;
}

/**
 * The single nearest item to `center` ([lng,lat]) with NO radius bound, or null
 * if nothing has a location. For place context on a moving target (aircraft /
 * ship) where the nearest city can be far — mid-ocean it still names the closest
 * landfall rather than showing nothing.
 */
export function nearest<T>(
  items: T[],
  center: [number, number],
  getPoint: (item: T) => [number, number] | null,
): Nearby<T> | null {
  let best: Nearby<T> | null = null;
  for (const item of items) {
    const p = getPoint(item);
    if (!p) continue;
    const distanceKm = haversineKm(center, p);
    if (!best || distanceKm < best.distanceKm) best = { item, distanceKm };
  }
  return best;
}

/** Compact distance readout, e.g. 4.2 → "4 km", 132.7 → "133 km". */
export function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

const COMPASS_16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

/**
 * Initial great-circle bearing in degrees (0–360, 0 = due north) from `from`
 * toward `to`, each [lng, lat]. Used to say which way an epicentre lies from a
 * city ("142 km NE of Tokyo" ⇒ bearing city→epicentre).
 */
export function initialBearingDeg(from: [number, number], to: [number, number]): number {
  const lat1 = toRad(from[1]);
  const lat2 = toRad(to[1]);
  const dLng = toRad(to[0] - from[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** 16-point compass abbreviation for a bearing in degrees (e.g. 47 → "NE"). */
export function compass16(bearingDeg: number): string {
  const norm = ((bearingDeg % 360) + 360) % 360;
  return COMPASS_16[Math.round(norm / 22.5) % 16];
}

/** Compass direction from a city ([lng,lat]) to an epicentre — "NE", "SSW", … */
export function bearingLabel(from: [number, number], to: [number, number]): string {
  return compass16(initialBearingDeg(from, to));
}

/** True when [lng,lat] falls inside a [west,south,east,north] box — wraps the
 *  antimeridian when west > east, same convention as `/api/cities`'s bbox. */
export function withinBbox(
  lng: number,
  lat: number,
  bbox: [number, number, number, number],
): boolean {
  const [w, s, e, n] = bbox;
  if (lat < s || lat > n) return false;
  return w <= e ? lng >= w && lng <= e : lng >= w || lng <= e;
}
