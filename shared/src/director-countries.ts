/**
 * Country spotlights for the auto-director's `country` kind.
 *
 * A curated catalog of countries the channel can "visit" — each entry frames the
 * whole country and carries its flag for the on-air card. The operator picks a
 * FAVOURITES subset per scene (DirectorConfig.countries, default UK + Japan);
 * only favourites become candidates, and the selector's fair rotation cycles
 * through them like any other kind. Data-free by design: the shot reads the live
 * weather layers (see the `country` preset in director-rois), so adding a country
 * here is just a name + flag + camera framing.
 */

export interface CountryShot {
  /** Stable id — the value stored in DirectorConfig.countries. */
  id: string;
  name: string;
  /** Flag emoji for the on-air card + operator picker. */
  flag: string;
  /** [lng, lat] framing centre. */
  center: [number, number];
  /** Zoom that frames the whole country (bigger country → lower zoom). */
  zoom: number;
  /** ISO-3166 alpha-2 code — joins to countries.geojson's `iso_a2` (globe glow)
   *  and the City model's `cc` (not currently used for city queries, which key
   *  off `bbox` instead, but kept as the canonical country identity). */
  iso2: string;
  /** [west, south, east, north] — an approximate mainland bounding box (not
   *  precise borders) used to scope cities/alerts/quakes to "this country"
   *  without needing real polygon geometry. Deliberately mainland-only for
   *  countries with far-flung territories, matching the existing center/zoom
   *  framing (e.g. France excludes overseas departments). */
  bbox: [number, number, number, number];
}

/** Everything the operator can favourite, roughly west→east within regions. */
export const COUNTRY_SHOTS: CountryShot[] = [
  { id: "usa", name: "United States", flag: "🇺🇸", center: [-98, 39], zoom: 3.3, iso2: "US", bbox: [-125, 24, -66, 49.5] },
  { id: "canada", name: "Canada", flag: "🇨🇦", center: [-96, 58], zoom: 3.0, iso2: "CA", bbox: [-141, 41.7, -52.6, 83.1] },
  { id: "mexico", name: "Mexico", flag: "🇲🇽", center: [-102, 24], zoom: 3.8, iso2: "MX", bbox: [-118.4, 14.5, -86.7, 32.7] },
  { id: "brazil", name: "Brazil", flag: "🇧🇷", center: [-53, -11], zoom: 3.3, iso2: "BR", bbox: [-74, -33.8, -34.8, 5.3] },
  { id: "argentina", name: "Argentina", flag: "🇦🇷", center: [-65, -36], zoom: 3.5, iso2: "AR", bbox: [-73.6, -55.1, -53.6, -21.8] },
  { id: "chile", name: "Chile", flag: "🇨🇱", center: [-71, -37], zoom: 3.6, iso2: "CL", bbox: [-75.7, -55.9, -66.4, -17.5] },
  { id: "iceland", name: "Iceland", flag: "🇮🇸", center: [-18.6, 64.9], zoom: 4.9, iso2: "IS", bbox: [-24.5, 63.3, -13.5, 66.6] },
  { id: "ireland", name: "Ireland", flag: "🇮🇪", center: [-8, 53.3], zoom: 5.0, iso2: "IE", bbox: [-10.7, 51.4, -5.9, 55.4] },
  { id: "uk", name: "United Kingdom", flag: "🇬🇧", center: [-2.5, 54.5], zoom: 4.4, iso2: "GB", bbox: [-8.2, 49.8, 1.8, 60.9] },
  { id: "portugal", name: "Portugal", flag: "🇵🇹", center: [-8, 39.6], zoom: 5.0, iso2: "PT", bbox: [-9.6, 36.8, -6.1, 42.2] },
  { id: "spain", name: "Spain", flag: "🇪🇸", center: [-3.7, 40], zoom: 4.5, iso2: "ES", bbox: [-9.4, 35.9, 4.4, 43.9] },
  { id: "france", name: "France", flag: "🇫🇷", center: [2.5, 46.5], zoom: 4.4, iso2: "FR", bbox: [-5.2, 41.3, 9.6, 51.2] },
  { id: "germany", name: "Germany", flag: "🇩🇪", center: [10.4, 51.2], zoom: 4.5, iso2: "DE", bbox: [5.9, 47.3, 15.1, 55.1] },
  { id: "italy", name: "Italy", flag: "🇮🇹", center: [12.8, 42.5], zoom: 4.4, iso2: "IT", bbox: [6.6, 36.6, 18.6, 47.1] },
  { id: "norway", name: "Norway", flag: "🇳🇴", center: [14, 64.5], zoom: 3.8, iso2: "NO", bbox: [4.6, 57.9, 31.1, 71.2] },
  { id: "sweden", name: "Sweden", flag: "🇸🇪", center: [17, 62.5], zoom: 4.0, iso2: "SE", bbox: [11.1, 55.3, 24.2, 69.1] },
  { id: "greece", name: "Greece", flag: "🇬🇷", center: [23, 38.5], zoom: 4.7, iso2: "GR", bbox: [19.4, 34.8, 28.3, 41.8] },
  { id: "turkey", name: "Turkey", flag: "🇹🇷", center: [35, 39], zoom: 4.3, iso2: "TR", bbox: [25.7, 35.8, 44.8, 42.1] },
  { id: "egypt", name: "Egypt", flag: "🇪🇬", center: [30, 26.5], zoom: 4.3, iso2: "EG", bbox: [24.7, 22, 36.9, 31.7] },
  { id: "south-africa", name: "South Africa", flag: "🇿🇦", center: [24.5, -29], zoom: 4.2, iso2: "ZA", bbox: [16.5, -34.8, 32.9, -22.1] },
  { id: "india", name: "India", flag: "🇮🇳", center: [79, 22], zoom: 3.7, iso2: "IN", bbox: [68.2, 8.1, 97.4, 35.5] },
  { id: "china", name: "China", flag: "🇨🇳", center: [104, 35], zoom: 3.3, iso2: "CN", bbox: [73.5, 18.2, 134.8, 53.6] },
  { id: "thailand", name: "Thailand", flag: "🇹🇭", center: [101, 15.5], zoom: 4.3, iso2: "TH", bbox: [97.3, 5.6, 105.6, 20.5] },
  { id: "vietnam", name: "Vietnam", flag: "🇻🇳", center: [107.5, 16.5], zoom: 4.2, iso2: "VN", bbox: [102.1, 8.4, 109.5, 23.4] },
  { id: "south-korea", name: "South Korea", flag: "🇰🇷", center: [127.8, 36.3], zoom: 4.9, iso2: "KR", bbox: [125.9, 33, 129.6, 38.6] },
  { id: "japan", name: "Japan", flag: "🇯🇵", center: [137.5, 37.5], zoom: 4.2, iso2: "JP", bbox: [129.4, 24.4, 145.8, 45.6] },
  { id: "philippines", name: "Philippines", flag: "🇵🇭", center: [122.5, 12.5], zoom: 4.2, iso2: "PH", bbox: [116.9, 4.6, 126.6, 21.1] },
  { id: "indonesia", name: "Indonesia", flag: "🇮🇩", center: [118, -2.5], zoom: 3.5, iso2: "ID", bbox: [95, -11, 141, 6] },
  { id: "australia", name: "Australia", flag: "🇦🇺", center: [134, -25.5], zoom: 3.4, iso2: "AU", bbox: [112.9, -43.7, 153.6, -10.1] },
  { id: "new-zealand", name: "New Zealand", flag: "🇳🇿", center: [172.5, -41.5], zoom: 4.3, iso2: "NZ", bbox: [166.4, -47.3, 178.6, -34.4] },
];

const byId = new Map(COUNTRY_SHOTS.map((c) => [c.id, c]));

/** Catalog lookup, or undefined for an id we don't know (stale config). */
export const countryShot = (id: string): CountryShot | undefined => byId.get(id);

/** The curated country whose bbox contains [lng,lat], or undefined outside all
 *  of them — lets a data-driven point (a round-up hotspot, say) snap to a real
 *  country instead of a raw coordinate. First catalog match wins. */
export function countryContaining(lng: number, lat: number): CountryShot | undefined {
  return COUNTRY_SHOTS.find(
    (c) => lng >= c.bbox[0] && lng <= c.bbox[2] && lat >= c.bbox[1] && lat <= c.bbox[3],
  );
}

/** The operator's starting favourites. */
export const DEFAULT_DIRECTOR_COUNTRIES: string[] = ["uk", "japan"];

/**
 * Validate an untrusted (HTTP) favourites patch: must be an array; keeps only
 * known catalog ids, deduped, catalog-ordered (so the picker and the rotation
 * agree). Returns null when the value isn't an array — merge keeps the base.
 */
export function sanitizeDirectorCountries(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const want = new Set(v.filter((x): x is string => typeof x === "string"));
  return COUNTRY_SHOTS.filter((c) => want.has(c.id)).map((c) => c.id);
}
