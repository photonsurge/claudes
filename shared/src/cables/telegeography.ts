import type { Cable, LandingPoint, LngLat } from "./types";

/**
 * TeleGeography Submarine Cable Map — the canonical open dataset of the world's
 * submarine fiber-optic cables and their landing stations. Published as GeoJSON
 * under the project repo; free to use with attribution.
 *
 * Cables: a FeatureCollection of (Multi)LineStrings, one feature per cable, with
 *   properties { id, name, color }.
 * Landing points: a FeatureCollection of Points, properties { id, name }.
 *
 * Repo: https://github.com/telegeography/www.submarinecablemap.com
 * The worker fetches these into Mongo; the public app reads only the cache.
 */
const RAW_BASE =
  "https://raw.githubusercontent.com/telegeography/www.submarinecablemap.com/master/web/public/api/v3";

export const CABLE_GEO_URL = `${RAW_BASE}/cable/cable-geo.json`;
export const LANDING_GEO_URL = `${RAW_BASE}/landing-point/landing-point-geo.json`;

export const CABLE_ATTRIBUTION = "Submarine cables © TeleGeography";

// ── GeoJSON shapes (only the fields we read) ───────────────────────────────
interface GeoFeature {
  properties?: { id?: string; name?: string; color?: string } | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
}
interface GeoCollection {
  features?: GeoFeature[];
}

/** True for a finite [lng,lat] pair. */
function isLngLat(v: unknown): v is LngLat {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

/** Coerce a LineString ([[lng,lat]…]) into a clean polyline. */
function lineToPath(coords: unknown): LngLat[] {
  if (!Array.isArray(coords)) return [];
  const path: LngLat[] = [];
  for (const pt of coords) if (isLngLat(pt)) path.push([pt[0], pt[1]]);
  return path;
}

/**
 * Parse the cable GeoJSON FeatureCollection into `Cable[]`. Handles both
 * LineString (single path) and MultiLineString (many paths) geometries; drops
 * features without a usable id or any vertices.
 */
export function parseCablesGeo(json: unknown): Cable[] {
  const features = (json as GeoCollection | null)?.features;
  if (!Array.isArray(features)) return [];

  const out: Cable[] = [];
  for (const f of features) {
    const id = String(f.properties?.id ?? "").trim();
    if (!id) continue;
    const geom = f.geometry;
    const coords = geom?.coordinates;
    let paths: LngLat[][];
    if (geom?.type === "MultiLineString" && Array.isArray(coords)) {
      paths = coords.map(lineToPath).filter((p) => p.length >= 2);
    } else if (geom?.type === "LineString") {
      const p = lineToPath(coords);
      paths = p.length >= 2 ? [p] : [];
    } else {
      paths = [];
    }
    if (!paths.length) continue;
    out.push({
      id,
      name: String(f.properties?.name ?? id),
      color: typeof f.properties?.color === "string" ? f.properties.color : undefined,
      paths,
    });
  }
  return out;
}

/** Parse the landing-point GeoJSON FeatureCollection into `LandingPoint[]`. */
export function parseLandingsGeo(json: unknown): LandingPoint[] {
  const features = (json as GeoCollection | null)?.features;
  if (!Array.isArray(features)) return [];

  const out: LandingPoint[] = [];
  for (const f of features) {
    const id = String(f.properties?.id ?? "").trim();
    const coords = f.geometry?.coordinates;
    if (!id || f.geometry?.type !== "Point" || !isLngLat(coords)) continue;
    out.push({
      id,
      name: String(f.properties?.name ?? id),
      lng: coords[0],
      lat: coords[1],
    });
  }
  return out;
}

/** Fetch + parse both feeds. Throws on network/HTTP error so the job can log it. */
export async function fetchCableData(
  fetchImpl: typeof fetch = fetch,
): Promise<{ cables: Cable[]; landings: LandingPoint[] }> {
  const [cableRes, landRes] = await Promise.all([
    fetchImpl(CABLE_GEO_URL),
    fetchImpl(LANDING_GEO_URL),
  ]);
  if (!cableRes.ok) throw new Error(`cable-geo ${cableRes.status}`);
  if (!landRes.ok) throw new Error(`landing-geo ${landRes.status}`);
  const [cableJson, landJson] = await Promise.all([cableRes.json(), landRes.json()]);
  return {
    cables: parseCablesGeo(cableJson),
    landings: parseLandingsGeo(landJson),
  };
}
