/**
 * Named region/country bboxes for camera framing (`fitBounds`). bbox is
 * [west, south, east, north].
 *
 * These are CURATED framing presets grouped for the region picker. The full
 * long tail of every country lives separately in `./countries` (baked from the
 * bundled Natural Earth GeoJSON) and is surfaced as a searchable dropdown.
 *
 * Longitude is normally −180..180, but an ocean centred on the antimeridian
 * (the Pacific) is allowed to run east past +180 so its [w,e] stays w<e and
 * frames the dateline; the camera normalises the centre back into range.
 */
export type RegionGroupId = "ocean" | "continent" | "country" | "europe" | "uk";

export interface iRegionPreset {
  id: string;
  label: string;
  bbox: [number, number, number, number];
  group: RegionGroupId;
  /** Pinned to the always-visible Favorites strip. */
  favorite?: boolean;
}

/** Display groups, in picker order. */
export const REGION_GROUPS: { id: RegionGroupId; label: string }[] = [
  { id: "ocean", label: "Oceans" },
  { id: "continent", label: "Continents" },
  { id: "country", label: "Key countries" },
  { id: "europe", label: "Europe" },
  { id: "uk", label: "UK & Isles" },
];

export const REGION_PRESETS: iRegionPreset[] = [
  // ── Oceans ──────────────────────────────────────────────────────────────
  { id: "pacific", label: "Pacific", bbox: [120, -60, 260, 60], group: "ocean" },
  { id: "atlantic", label: "Atlantic", bbox: [-75, -55, 20, 65], group: "ocean" },
  { id: "indian", label: "Indian", bbox: [40, -55, 110, 30], group: "ocean" },
  { id: "southern", label: "Southern", bbox: [-180, -75, 180, -45], group: "ocean" },
  { id: "arctic", label: "Arctic", bbox: [-180, 66, 180, 90], group: "ocean" },
  { id: "north_atlantic", label: "North Atlantic", bbox: [-70, 25, 5, 65], group: "ocean", favorite: true },
  { id: "mediterranean", label: "Mediterranean", bbox: [-6, 30, 37, 47], group: "ocean", favorite: true },

  // ── Continents ──────────────────────────────────────────────────────────
  { id: "world", label: "World", bbox: [-180, -85, 180, 85], group: "continent", favorite: true },
  { id: "north_america", label: "North America", bbox: [-168, 7, -52, 72], group: "continent" },
  { id: "south_america", label: "South America", bbox: [-82, -56, -34, 13], group: "continent" },
  { id: "europe", label: "Europe", bbox: [-25, 34, 45, 72], group: "continent" },
  { id: "africa", label: "Africa", bbox: [-22, -39, 56, 42], group: "continent" },
  { id: "asia", label: "Asia", bbox: [40, 5, 150, 78], group: "continent" },
  { id: "east_asia", label: "East Asia", bbox: [100, 20, 146, 47], group: "continent" },
  { id: "south_asia", label: "South Asia", bbox: [66, 6, 97, 36], group: "continent" },
  { id: "oceania", label: "Oceania", bbox: [110, -50, 180, 5], group: "continent" },

  // ── Key countries ───────────────────────────────────────────────────────
  { id: "conus", label: "United States", bbox: [-125, 24, -66, 50], group: "country", favorite: true },
  { id: "canada", label: "Canada", bbox: [-141, 42, -52, 72], group: "country" },
  { id: "mexico", label: "Mexico", bbox: [-118, 14, -86, 33], group: "country" },
  { id: "brazil", label: "Brazil", bbox: [-74, -34, -34, 6], group: "country" },
  { id: "russia", label: "Russia", bbox: [30, 41, 180, 78], group: "country" },
  { id: "china", label: "China", bbox: [73, 18, 135, 54], group: "country" },
  { id: "india", label: "India", bbox: [68, 6, 98, 36], group: "country" },
  { id: "japan", label: "Japan", bbox: [128, 30, 146, 46], group: "country" },
  { id: "indonesia", label: "Indonesia", bbox: [95, -11, 141, 6], group: "country" },
  { id: "australia", label: "Australia", bbox: [112, -44, 154, -10], group: "country" },
  { id: "egypt", label: "Egypt", bbox: [24, 22, 37, 32], group: "country" },
  { id: "south_africa", label: "South Africa", bbox: [16, -35, 33, -22], group: "country" },

  // ── Europe (big EU) ─────────────────────────────────────────────────────
  { id: "western_europe", label: "Western Europe", bbox: [-11, 36, 20, 60], group: "europe", favorite: true },
  { id: "france", label: "France", bbox: [-5, 41, 9, 51], group: "europe" },
  { id: "germany", label: "Germany", bbox: [5, 47, 15, 55], group: "europe" },
  { id: "spain", label: "Spain", bbox: [-10, 35, 5, 44], group: "europe" },
  { id: "italy", label: "Italy", bbox: [6, 36, 19, 47], group: "europe" },
  { id: "poland", label: "Poland", bbox: [14, 49, 24, 55], group: "europe" },
  { id: "netherlands", label: "Netherlands", bbox: [3, 50, 8, 54], group: "europe" },

  // ── UK & Isles ──────────────────────────────────────────────────────────
  { id: "uk", label: "United Kingdom", bbox: [-16, 46, 7, 65], group: "uk", favorite: true },
  { id: "england", label: "England", bbox: [-6, 50, 2, 56], group: "uk" },
  { id: "scotland", label: "Scotland", bbox: [-8, 54.5, -0.5, 61], group: "uk" },
  { id: "wales", label: "Wales", bbox: [-5.5, 51.3, -2.6, 53.5], group: "uk" },
  { id: "northern_ireland", label: "Northern Ireland", bbox: [-8.2, 54, -5.4, 55.3], group: "uk" },
  { id: "ireland", label: "Ireland", bbox: [-11, 51, -5, 55.5], group: "uk" },
];

export const getRegion = (id: string): iRegionPreset | undefined =>
  REGION_PRESETS.find((r) => r.id === id);

/** Presets in a given group, in declared order. */
export const regionsInGroup = (group: RegionGroupId): iRegionPreset[] =>
  REGION_PRESETS.filter((r) => r.group === group);

/** The curated Favorites strip, in declared order. */
export const favoriteRegions = (): iRegionPreset[] =>
  REGION_PRESETS.filter((r) => r.favorite);
