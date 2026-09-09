/**
 * countries.geojson, fetched and parsed ONCE per page and shared by everything
 * that needs a country boundary: the basemap borders (a PathLayer over every
 * ring), the spotlight glow (by ISO code), and the bbox lookups.
 *
 * WHY: the file is 4 MB. Before this the borders GeoJsonLayer fetched and
 * parsed it, countryGlow fetched and parsed it again, and — because a
 * stroke-only GeoJsonLayer still builds a polygons-fill sublayer — deck earcut
 * every country polygon on each cold start, which is every OBS hard reset (see
 * outline-rings.ts). Now: one fetch, one parse, and the borders tessellate as
 * paths only.
 *
 * Every export hands back the SAME promise for the life of the page: deck
 * compares an async `data` prop by identity, so a stable promise means one
 * fetch and one tessellation per layer lifetime, where a fresh promise per
 * rebuild would refetch AND re-tessellate on every globe commit.
 */
import { COUNTRIES_URL } from "./data-urls";
import { outlineRings, type OutlineRing } from "./outline-rings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CountryFeature = any;

let list: Promise<CountryFeature[]> | null = null;
let byIso: Promise<Map<string, CountryFeature>> | null = null;
let rings: Promise<OutlineRing<CountryFeature>[]> | null = null;

/** Every country feature in file order; `[]` (with a console warning) if the fetch fails. */
export function loadCountryFeatureList(): Promise<CountryFeature[]> {
  if (!list) {
    list =
      typeof fetch !== "function"
        ? Promise.resolve([]) // no network here (tests / SSR): nothing to draw
        : Promise.resolve()
            .then(() => fetch(COUNTRIES_URL))
            .then((r) => {
              // Only an explicit failure counts — a minimal Response-like (tests) has no `ok`.
              if (r.ok === false) throw new Error(`HTTP ${r.status}`);
              return r.json();
            })
            .then((fc: { features?: CountryFeature[] }) => (Array.isArray(fc?.features) ? fc.features : []))
            .catch((err) => {
              console.warn(`[countries] ${COUNTRIES_URL} failed: ${String((err as Error)?.message ?? err)}`);
              return [];
            });
  }
  return list;
}

/** The features indexed by ISO-3166 alpha-2 (`iso_a2`, upper-cased); features without one are skipped. */
export function loadCountryFeatures(): Promise<Map<string, CountryFeature>> {
  if (!byIso) {
    byIso = loadCountryFeatureList().then((features) => {
      const m = new Map<string, CountryFeature>();
      for (const f of features) {
        const iso = String(f?.properties?.iso_a2 ?? "").toUpperCase();
        if (iso) m.set(iso, f);
      }
      return m;
    });
  }
  return byIso;
}

/** The borders PathLayer's `data`: every ring of every country, one stable promise per page. */
export function countryBorderRings(): Promise<OutlineRing<CountryFeature>[]> {
  if (!rings) rings = loadCountryFeatureList().then((features) => outlineRings(features));
  return rings;
}

/** Forget the cached fetch (tests only). */
export function resetCountryFeaturesForTests(): void {
  list = null;
  byIso = null;
  rings = null;
}
