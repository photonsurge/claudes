/**
 * PURE geocode normalisation, split from the route so it can be unit-tested
 * without importing `next/server` (which needs the Node web globals).
 */

/** A raw Nominatim search hit (the fields we use). */
export interface NominatimHit {
  lat: string;
  lon: string;
  /** [south, north, west, east] as strings (Nominatim order). */
  boundingbox?: [string, string, string, string];
  display_name?: string;
}

export interface NormalizedGeocode {
  /** [lng, lat] */
  center: [number, number];
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  label: string;
}

/**
 * Normalise the first Nominatim hit to our app shape. Nominatim's boundingbox is
 * [south, north, west, east]; we emit [west, south, east, north]. Returns null
 * on a missing/invalid hit.
 */
export function normalizeGeocode(
  hit: NominatimHit | undefined | null,
): NormalizedGeocode | null {
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  let bbox: [number, number, number, number];
  if (hit.boundingbox && hit.boundingbox.length === 4) {
    const [s, n, w, e] = hit.boundingbox.map(Number);
    bbox = [w, s, e, n];
  } else {
    const d = 0.1;
    bbox = [lng - d, lat - d, lng + d, lat + d];
  }

  return { center: [lng, lat], bbox, label: hit.display_name ?? "" };
}
