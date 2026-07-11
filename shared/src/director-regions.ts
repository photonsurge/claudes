/**
 * Region ("area") spotlights for the auto-director's `region` kind — the Region
 * catalog cousin of `director-countries`. A curated subset of REGION_PRESETS the
 * channel can "visit": each entry frames a named area (a continent, an EU bloc, a
 * sub-continental band like the Sahel) and reads the live weather layers, exactly
 * like a country spotlight. The operator favourites a subset per scene
 * (DirectorConfig.regions, default none — opt-in); only favourites become
 * candidates.
 *
 * Eligibility is LAND regions + whole continents (see ELIGIBLE_GROUPS) minus the
 * whole-planet "world" framing: oceans are excluded because a region spotlight's
 * cities / round-up / area-forecast slides are meaningless over open water, and
 * "world" just duplicates the global spin.
 *
 * Data-free by design (like the country catalog): the camera framing is derived
 * from each preset's bbox (regions store no hand-tuned center/zoom), and the
 * on-air enrichment (photo/blurb, cities, round-up) is read client-side off the
 * Mongo Region doc keyed by the same `regionId`.
 */
import { REGION_PRESETS, type RegionGroupId } from "./regions";

export interface RegionShot {
  /** Stable id — matches REGION_PRESETS + the Mongo Region `regionId`; the value
   *  stored in DirectorConfig.regions. */
  id: string;
  name: string;
  group: RegionGroupId;
  /** [west, south, east, north] — scopes cities/alerts/quakes to the area. */
  bbox: [number, number, number, number];
  /** [lng, lat] framing centre, derived from the bbox. */
  center: [number, number];
  /** Zoom that frames the whole area, derived from the bbox span. */
  zoom: number;
}

/** Region groups eligible to be an area spotlight — land + continents, no oceans. */
const ELIGIBLE_GROUPS = new Set<RegionGroupId>([
  "continent",
  "europe",
  "n_america",
  "asia",
  "africa",
  "s_america",
  "oceania",
]);

/** The whole-planet framing preset (in the `continent` group) — excluded: a
 *  region spotlight of "the world" is just the global spin. */
const EXCLUDED_IDS = new Set(["world"]);

/**
 * Derive a {center, zoom} camera that frames a [w,s,e,n] bbox on the broadcast
 * globe. Regions carry only a bbox (unlike the hand-tuned country catalog), so
 * the framing is computed: centre is the bbox midpoint; zoom is fitted from the
 * larger of the (latitude-corrected) longitude span and the latitude span, with
 * a little padding, clamped to a sane broadcast range. Approximate by design —
 * the shot also drifts, and the operator can retune per scene.
 */
export function cameraForBbox(bbox: [number, number, number, number]): {
  center: [number, number];
  zoom: number;
} {
  const [w, s, e, n] = bbox;
  const center: [number, number] = [(w + e) / 2, (s + n) / 2];
  const latSpan = Math.max(1e-3, n - s);
  const lngSpan = Math.max(1e-3, (e - w) * Math.cos((center[1] * Math.PI) / 180));
  const span = Math.max(lngSpan, latSpan) * 1.15; // pad so the area isn't edge-to-edge
  const zoom = Math.max(1.2, Math.min(5.0, Math.log2(360 / span) - 0.4));
  return { center, zoom: Math.round(zoom * 10) / 10 };
}

/** The curated catalog the operator favourites from, declaration order. */
export const REGION_SHOTS: RegionShot[] = REGION_PRESETS.filter(
  (r) => ELIGIBLE_GROUPS.has(r.group) && !EXCLUDED_IDS.has(r.id),
).map((r) => {
  const { center, zoom } = cameraForBbox(r.bbox);
  return { id: r.id, name: r.label, group: r.group, bbox: r.bbox, center, zoom };
});

const byId = new Map(REGION_SHOTS.map((r) => [r.id, r]));

/** Catalog lookup, or undefined for an id we don't know (stale config). */
export const regionShot = (id: string): RegionShot | undefined => byId.get(id);

/** The operator's starting favourites — none: the region kind is opt-in. */
export const DEFAULT_DIRECTOR_REGIONS: string[] = [];

/**
 * Validate an untrusted (HTTP) favourites patch: must be an array; keeps only
 * known catalog ids, deduped, catalog-ordered (so the picker and the rotation
 * agree). Returns null when the value isn't an array — merge keeps the base.
 * Mirrors `sanitizeDirectorCountries`.
 */
export function sanitizeDirectorRegions(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const want = new Set(v.filter((x): x is string => typeof x === "string"));
  return REGION_SHOTS.filter((r) => want.has(r.id)).map((r) => r.id);
}
