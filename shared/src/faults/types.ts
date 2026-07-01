/**
 * Tectonic plate-boundary domain types, shared by the worker (ingest /
 * persistence) and the public app (overlay). Near-static reference geography:
 * the worker snapshots the Bird (2003) PB2002 boundary GeoJSON into Mongo on a
 * slow cron and the public app only ever reads the cached copy (same rule as
 * cables / live tracks).
 */

/** [lng, lat] in degrees. */
export type LngLat = [number, number];

/**
 * One plate-boundary segment. The source is a set of (Multi)LineStrings, one
 * feature per boundary stretch, tagged with the two plates it separates (e.g.
 * "AF-AN"). Geometry is an array of polylines so a MultiLineString stays whole.
 */
export interface Fault {
  /** Deterministic slug ("AF-AN-3"): plate-pair name + per-name index. Upsert key. */
  id: string;
  /** Plate-pair name from the source, e.g. "AF-AN". */
  name: string;
  /** Boundary type from the source when present (often blank in PB2002). */
  type?: string;
  /** One or more polylines; each is a list of [lng,lat] vertices. */
  paths: LngLat[][];
}

/** Everything the fault overlay needs in one cached payload. */
export interface FaultData {
  faults: Fault[];
}
