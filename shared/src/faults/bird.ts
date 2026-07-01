import type { Fault, LngLat } from "./types";

/**
 * Bird (2003) "PB2002" digital plate-boundary model — the canonical open dataset
 * of the world's tectonic plate boundaries, published as GeoJSON by the
 * fraxen/tectonicplates project under the Open Data Commons Attribution License.
 *
 * Boundaries: a FeatureCollection of (Multi)LineStrings, one feature per boundary
 *   stretch, with properties { Name: "AF-AN", Type, PlateA, PlateB, Source }.
 *
 * The worker fetches this into Mongo; the public app reads only the cache.
 * Override FAULT_GEO_URL if the source path ever moves.
 */
export const FAULT_GEO_URL =
  process.env.FAULT_GEO_URL ||
  "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json";

export const FAULT_ATTRIBUTION =
  "Plate boundaries: Bird (2003) PB2002, via fraxen/tectonicplates (ODC-By)";

// ── GeoJSON shapes (only the fields we read) ───────────────────────────────
interface GeoFeature {
  properties?: { Name?: string; Type?: string } | null;
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
 * Parse the plate-boundary GeoJSON FeatureCollection into `Fault[]`. Handles both
 * LineString (single path) and MultiLineString (many paths) geometries; drops
 * features without any usable vertices.
 *
 * PB2002 has no per-feature unique id (several stretches share one plate-pair
 * `Name`), so we mint a deterministic id `${Name}-${n}` from a per-name counter
 * — stable across re-snapshots as long as the source keeps its feature order,
 * which lets the repo upsert-and-prune like it does for cables.
 */
export function parseFaultsGeo(json: unknown): Fault[] {
  const features = (json as GeoCollection | null)?.features;
  if (!Array.isArray(features)) return [];

  const seq = new Map<string, number>();
  const out: Fault[] = [];
  for (const f of features) {
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

    const name = String(f.properties?.Name ?? "boundary").trim() || "boundary";
    const n = seq.get(name) ?? 0;
    seq.set(name, n + 1);
    out.push({
      id: `${name}-${n}`,
      name,
      type: typeof f.properties?.Type === "string" && f.properties.Type ? f.properties.Type : undefined,
      paths,
    });
  }
  return out;
}

/** Fetch + parse the boundary feed. Throws on network/HTTP error so the job can log it. */
export async function fetchFaultData(
  fetchImpl: typeof fetch = fetch,
): Promise<{ faults: Fault[] }> {
  const res = await fetchImpl(FAULT_GEO_URL);
  if (!res.ok) throw new Error(`plate-boundaries ${res.status}`);
  const json = await res.json();
  return { faults: parseFaultsGeo(json) };
}
