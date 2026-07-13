/**
 * Tiny geo helpers shared by the matcher-based event adapters (EONET, Copernicus).
 * Kept worker-local + dependency-free; the shared geo module owns polygon area/bbox.
 */

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km between two [lat,lng] points. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Representative [lng,lat] for a GeoJSON geometry (Point → coord; ring/multi → mean of first ring). */
export function representativePoint(geometry: { type?: string; coordinates?: unknown } | null | undefined): [number, number] | null {
  const co = geometry?.coordinates as unknown;
  if (!co) return null;
  if (geometry?.type === "Point") {
    const p = co as number[];
    return p.length >= 2 ? [p[0], p[1]] : null;
  }
  const ring: unknown =
    geometry?.type === "MultiPolygon" ? (co as unknown[][][])[0]?.[0] : (co as unknown[][])[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let k = 0;
  for (const pt of ring as [number, number][]) {
    if (Array.isArray(pt) && pt.length >= 2) {
      sx += pt[0];
      sy += pt[1];
      k++;
    }
  }
  return k ? [sx / k, sy / k] : null;
}
