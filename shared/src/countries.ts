/**
 * Country bboxes for the region picker's "All countries" dropdown. The data is
 * baked from the bundled Natural Earth admin-0 GeoJSON by
 * `scripts/gen-country-bboxes.mjs` (run `yarn gen:countries` to refresh) — this
 * module is just the typed accessor over it.
 */
import { COUNTRY_BBOXES, type iCountryBbox } from "./countries.generated";

export { COUNTRY_BBOXES, type iCountryBbox };

/** Look up a country by its id (iso alpha-2 lowercased, or a name slug). */
export const getCountry = (id: string): iCountryBbox | undefined =>
  COUNTRY_BBOXES.find((c) => c.id === id);

/** Case-insensitive name/id substring filter, already name-sorted. Blank → all. */
export function searchCountries(query: string): iCountryBbox[] {
  const q = query.trim().toLowerCase();
  if (!q) return COUNTRY_BBOXES;
  return COUNTRY_BBOXES.filter(
    (c) => c.name.toLowerCase().includes(q) || c.id.includes(q),
  );
}

/** The full-catalog country whose mainland bbox contains [lng,lat], or undefined
 *  over open ocean / a landmass with no bbox match (first catalog match wins on
 *  the rare overlap). Unlike `director-countries.ts`'s `countryContaining` (a
 *  curated ~30-country subset for camera spotlights), this checks all ~240
 *  countries — for callers that just need "what country is this point in",
 *  e.g. round-up hotspot labelling. */
export function countryBboxContaining(lng: number, lat: number): iCountryBbox | undefined {
  return COUNTRY_BBOXES.find(
    (c) => lng >= c.bbox[0] && lng <= c.bbox[2] && lat >= c.bbox[1] && lat <= c.bbox[3],
  );
}
