/**
 * Notable sea points for the auto-director's `ocean` kind.
 *
 * The `ocean` kind's original candidate is a single fixed-centre global spin
 * that TOURS the ingested ocean fields (SST → swell → salinity) — it never
 * settles on a specific location. This catalog gives it named, held-still
 * (autoSpin off) shots too, fair-rotated alongside the spin, so features that
 * depend on a real focus point (the sea-temp-at-depth profile/map) get real
 * airtime instead of wherever the spin happened to drift to. Mirrors
 * `director-countries.ts`'s shape exactly. Data-free by design: the shot
 * reads the live weather layers, so adding a point here is just a name +
 * blurb + camera framing.
 */

export interface SeaPointShot {
  /** Stable id — used as the segment subject (`ocean:<id>`). */
  id: string;
  name: string;
  /** One-line description shown in the on-air subtitle. */
  blurb: string;
  /** [lng, lat] framing centre. */
  center: [number, number];
  /** Zoom that frames the feature as a regional (not global) shot. */
  zoom: number;
}

/** Oceanographically notable open-ocean locations, roughly west→east. */
export const SEA_POINTS: SeaPointShot[] = [
  { id: "gulf-stream", name: "Gulf Stream", blurb: "Warm western-boundary current, N. Atlantic", center: [-70, 36], zoom: 4.5 },
  { id: "sargasso-sea", name: "Sargasso Sea", blurb: "Becalmed subtropical gyre core", center: [-60, 30], zoom: 4 },
  { id: "drake-passage", name: "Drake Passage", blurb: "Antarctic Circumpolar Current", center: [-65, -60], zoom: 4 },
  { id: "humboldt", name: "Humboldt Current", blurb: "Cold upwelling off Peru & Chile", center: [-75, -20], zoom: 4 },
  { id: "norwegian-sea", name: "Norwegian Sea", blurb: "Where Gulf Stream water meets the Arctic", center: [2, 70], zoom: 3.5 },
  { id: "agulhas", name: "Agulhas Current", blurb: "Warm current off South Africa", center: [28, -33], zoom: 4.5 },
  { id: "bay-of-bengal", name: "Bay of Bengal", blurb: "Warm cyclone nursery, N. Indian Ocean", center: [88, 15], zoom: 4.5 },
  { id: "warm-pool", name: "Indo-Pacific Warm Pool", blurb: "Earth's largest reservoir of warm water", center: [130, 0], zoom: 3.5 },
  { id: "kuroshio", name: "Kuroshio Current", blurb: 'The "Black Stream", off Japan', center: [145, 35], zoom: 4.5 },
  { id: "mariana-trench", name: "Mariana Trench", blurb: "Deepest point in the ocean", center: [142.2, 11.35], zoom: 5 },
];

export const seaPointShot = (id: string): SeaPointShot | undefined =>
  SEA_POINTS.find((p) => p.id === id);

/** Default favourites: every catalog entry, so behaviour is unchanged until
 *  an operator actually deselects one in DirectorPanel. */
export const DEFAULT_SEA_POINTS: string[] = SEA_POINTS.map((p) => p.id);

/**
 * Sanitize a `DirectorConfig.seaPoints` patch. Mirrors
 * `sanitizeDirectorCountries` exactly: non-array -> null (merge keeps the
 * base); otherwise keeps only known ids, deduped, in catalog order.
 */
export function sanitizeDirectorSeaPoints(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const want = new Set(v.filter((x): x is string => typeof x === "string"));
  return SEA_POINTS.filter((p) => want.has(p.id)).map((p) => p.id);
}
