/**
 * Submarine fiber-optic cable domain types, shared by the worker (ingest /
 * persistence) and the public app (overlay). Near-static reference data: the
 * worker snapshots TeleGeography's open GeoJSON into Mongo on a slow cron and
 * the public app only ever reads the cached copy (same rule as live tracks).
 */

/** [lng, lat] in degrees. */
export type LngLat = [number, number];

/**
 * One submarine cable. A cable can make landfall in several disconnected
 * stretches (a MultiLineString in the source), so its geometry is an array of
 * polylines rather than a single path.
 */
export interface Cable {
  /** TeleGeography slug, e.g. "marea". Stable id for dedup. */
  id: string;
  name: string;
  /** Source-provided display colour as "#rrggbb" (cables are grouped by hue). */
  color?: string;
  /** One or more polylines; each is a list of [lng,lat] vertices. */
  paths: LngLat[][];
}

/** A coastal landing station where one or more cables come ashore. */
export interface LandingPoint {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

/** Everything the cable overlay needs in one cached payload. */
export interface CableData {
  cables: Cable[];
  landings: LandingPoint[];
}
