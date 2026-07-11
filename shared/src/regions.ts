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
export type RegionGroupId =
  | "ocean"
  | "continent"
  | "europe"
  | "n_america"
  | "asia"
  | "africa"
  | "s_america"
  | "oceania";

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
  { id: "europe", label: "Europe" },
  { id: "n_america", label: "N. America" },
  { id: "asia", label: "Asia" },
  { id: "africa", label: "Africa" },
  { id: "s_america", label: "S. America" },
  { id: "oceania", label: "Oceania" },
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
  // Antarctica spans every longitude below ~60°S — bbox frames the whole continent.
  { id: "antarctica", label: "Antarctica", bbox: [-180, -90, 180, -60], group: "continent" },

  // ── Europe (sub-regions) ──────────────────────────────────────────────────
  // The UK exists once, here — favourite-pinned to the Favorites strip (home region).
  { id: "uk", label: "United Kingdom", bbox: [-16, 46, 7, 65], group: "europe", favorite: true },
  { id: "scandinavia", label: "Scandinavia", bbox: [4, 54, 32, 71], group: "europe" },
  { id: "iberia", label: "Iberia", bbox: [-10, 36, 4, 44], group: "europe" },
  { id: "central_europe", label: "Central Europe & Alps", bbox: [2, 43, 20, 52], group: "europe" },
  { id: "balkans", label: "Balkans", bbox: [13, 39, 30, 48], group: "europe" },
  { id: "eastern_europe", label: "Eastern Europe", bbox: [14, 44, 40, 60], group: "europe" },

  // ── North America (sub-regions) ───────────────────────────────────────────
  { id: "pacific_nw", label: "Pacific Northwest", bbox: [-130, 42, -110, 52], group: "n_america" },
  { id: "us_west", label: "US West", bbox: [-125, 31, -102, 42], group: "n_america" },
  { id: "us_plains", label: "US Plains", bbox: [-105, 30, -87, 49], group: "n_america" },
  { id: "us_northeast", label: "US Northeast", bbox: [-82, 38, -66, 48], group: "n_america" },
  { id: "us_gulf_southeast", label: "US Gulf & Southeast", bbox: [-98, 24, -75, 37], group: "n_america" },
  { id: "great_lakes", label: "Great Lakes", bbox: [-93, 41, -75, 49], group: "n_america" },
  { id: "caribbean", label: "Caribbean", bbox: [-88, 9, -59, 27], group: "n_america" },
  { id: "central_america", label: "Central America", bbox: [-93, 7, -77, 19], group: "n_america" },

  // ── Asia (sub-regions) ────────────────────────────────────────────────────
  { id: "middle_east", label: "Middle East", bbox: [32, 12, 63, 42], group: "asia" },
  { id: "central_asia", label: "Central Asia", bbox: [46, 35, 88, 56], group: "asia" },
  { id: "siberia", label: "Siberia", bbox: [60, 50, 180, 78], group: "asia" },
  { id: "southeast_asia", label: "Southeast Asia", bbox: [92, -11, 141, 24], group: "asia" },

  // ── Africa (sub-regions) ──────────────────────────────────────────────────
  { id: "maghreb", label: "Maghreb & N. Africa", bbox: [-13, 20, 37, 38], group: "africa" },
  { id: "sahel", label: "Sahel", bbox: [-18, 10, 40, 18], group: "africa" },
  { id: "west_africa", label: "West Africa", bbox: [-18, 4, 16, 16], group: "africa" },
  { id: "horn_of_africa", label: "Horn of Africa", bbox: [32, -2, 52, 18], group: "africa" },
  { id: "southern_africa", label: "Southern Africa", bbox: [11, -35, 41, -15], group: "africa" },

  // ── South America (sub-regions) ───────────────────────────────────────────
  { id: "amazonia", label: "Amazonia", bbox: [-79, -12, -48, 6], group: "s_america" },
  { id: "andes", label: "Andes", bbox: [-80, -40, -62, 5], group: "s_america" },
  { id: "southern_cone", label: "Southern Cone", bbox: [-76, -56, -53, -30], group: "s_america" },

  // ── Oceania (sub-regions) ─────────────────────────────────────────────────
  { id: "se_australia", label: "SE Australia", bbox: [138, -39, 154, -25], group: "oceania" },
  { id: "new_zealand", label: "New Zealand", bbox: [166, -47, 179, -34], group: "oceania" },
  // Melanesia→Polynesia crosses the antimeridian — east runs past +180 (w<e), like the Pacific ocean preset.
  { id: "pacific_islands", label: "Pacific Islands", bbox: [155, -22, 195, 2], group: "oceania" },
];

export const getRegion = (id: string): iRegionPreset | undefined =>
  REGION_PRESETS.find((r) => r.id === id);

/** Presets in a given group, in declared order. */
export const regionsInGroup = (group: RegionGroupId): iRegionPreset[] =>
  REGION_PRESETS.filter((r) => r.group === group);

/** The curated Favorites strip, in declared order. */
export const favoriteRegions = (): iRegionPreset[] =>
  REGION_PRESETS.filter((r) => r.favorite);
