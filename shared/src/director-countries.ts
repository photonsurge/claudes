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
}

/** Everything the operator can favourite, roughly west→east within regions. */
export const COUNTRY_SHOTS: CountryShot[] = [
  { id: "usa", name: "United States", flag: "🇺🇸", center: [-98, 39], zoom: 3.3 },
  { id: "canada", name: "Canada", flag: "🇨🇦", center: [-96, 58], zoom: 3.0 },
  { id: "mexico", name: "Mexico", flag: "🇲🇽", center: [-102, 24], zoom: 3.8 },
  { id: "brazil", name: "Brazil", flag: "🇧🇷", center: [-53, -11], zoom: 3.3 },
  { id: "argentina", name: "Argentina", flag: "🇦🇷", center: [-65, -36], zoom: 3.5 },
  { id: "chile", name: "Chile", flag: "🇨🇱", center: [-71, -37], zoom: 3.6 },
  { id: "iceland", name: "Iceland", flag: "🇮🇸", center: [-18.6, 64.9], zoom: 4.9 },
  { id: "ireland", name: "Ireland", flag: "🇮🇪", center: [-8, 53.3], zoom: 5.0 },
  { id: "uk", name: "United Kingdom", flag: "🇬🇧", center: [-2.5, 54.5], zoom: 4.4 },
  { id: "portugal", name: "Portugal", flag: "🇵🇹", center: [-8, 39.6], zoom: 5.0 },
  { id: "spain", name: "Spain", flag: "🇪🇸", center: [-3.7, 40], zoom: 4.5 },
  { id: "france", name: "France", flag: "🇫🇷", center: [2.5, 46.5], zoom: 4.4 },
  { id: "germany", name: "Germany", flag: "🇩🇪", center: [10.4, 51.2], zoom: 4.5 },
  { id: "italy", name: "Italy", flag: "🇮🇹", center: [12.8, 42.5], zoom: 4.4 },
  { id: "norway", name: "Norway", flag: "🇳🇴", center: [14, 64.5], zoom: 3.8 },
  { id: "sweden", name: "Sweden", flag: "🇸🇪", center: [17, 62.5], zoom: 4.0 },
  { id: "greece", name: "Greece", flag: "🇬🇷", center: [23, 38.5], zoom: 4.7 },
  { id: "turkey", name: "Turkey", flag: "🇹🇷", center: [35, 39], zoom: 4.3 },
  { id: "egypt", name: "Egypt", flag: "🇪🇬", center: [30, 26.5], zoom: 4.3 },
  { id: "south-africa", name: "South Africa", flag: "🇿🇦", center: [24.5, -29], zoom: 4.2 },
  { id: "india", name: "India", flag: "🇮🇳", center: [79, 22], zoom: 3.7 },
  { id: "china", name: "China", flag: "🇨🇳", center: [104, 35], zoom: 3.3 },
  { id: "thailand", name: "Thailand", flag: "🇹🇭", center: [101, 15.5], zoom: 4.3 },
  { id: "vietnam", name: "Vietnam", flag: "🇻🇳", center: [107.5, 16.5], zoom: 4.2 },
  { id: "south-korea", name: "South Korea", flag: "🇰🇷", center: [127.8, 36.3], zoom: 4.9 },
  { id: "japan", name: "Japan", flag: "🇯🇵", center: [137.5, 37.5], zoom: 4.2 },
  { id: "philippines", name: "Philippines", flag: "🇵🇭", center: [122.5, 12.5], zoom: 4.2 },
  { id: "indonesia", name: "Indonesia", flag: "🇮🇩", center: [118, -2.5], zoom: 3.5 },
  { id: "australia", name: "Australia", flag: "🇦🇺", center: [134, -25.5], zoom: 3.4 },
  { id: "new-zealand", name: "New Zealand", flag: "🇳🇿", center: [172.5, -41.5], zoom: 4.3 },
];

const byId = new Map(COUNTRY_SHOTS.map((c) => [c.id, c]));

/** Catalog lookup, or undefined for an id we don't know (stale config). */
export const countryShot = (id: string): CountryShot | undefined => byId.get(id);

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
