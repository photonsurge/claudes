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
  for (const item of items) {
    const p = getPoint(item);
    if (!p) continue;
    const distanceKm = haversineKm(center, p);
    if (distanceKm <= radiusKm) out.push({ item, distanceKm });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out;
}

/** Compact distance readout, e.g. 4.2 → "4 km", 132.7 → "133 km". */
export function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
