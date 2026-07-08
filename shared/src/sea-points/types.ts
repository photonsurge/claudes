/**
 * Ocean-monitoring-point domain type, shared by the worker (Director reads +
 * seed script) and the public app (admin CRUD). Mirrors `shared/src/cams/types.ts`'s
 * shape/role for a flat named-point catalog.
 */
export interface SeaPoint {
  /** Stable slug — the upsert key. e.g. "nino-3-4". */
  pointId: string;
  name: string;
  /** One-line description shown in the on-air subtitle. */
  blurb: string;
  /** Degrees, −90..90. */
  lat: number;
  /** Degrees, −180..180. */
  lng: number;
  /** Zoom that frames the feature as a regional (not global) shot. */
  zoom: number;
  /** Cycles through the sea-temp-at-depth chapters instead of a fixed depth. */
  depthCycle: boolean;
  /** Off points are skipped by the Director without being deleted. */
  enabled: boolean;
}
