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
