/**
 * PURE parsers for the GeoNames city gazetteer — turn the raw TSV dumps into the
 * city docs the globe overlay renders. No network, no unzip, no DB: the caller
 * (worker seed job / CLI) fetches + unzips, then hands the decoded text here, so
 * the mapping stays unit-testable. See worker/src/jobs/cities.ts for the IO glue.
 *
 * GeoNames "geoname table" is tab-separated; we use a handful of its columns.
 * Population drives the globe's progressive label reveal (see cityLabelMinZoom),
 * so a denser tier just fades smaller towns in as you zoom — never a busier view.
 */

/** GeoNames download tiers, coarsest → finest (population floor in the name). */
export const GEONAMES_TIERS = ["cities15000", "cities5000", "cities1000", "cities500"] as const;
export type GeonamesTier = (typeof GEONAMES_TIERS)[number];

/** Default seed tier — ≈27k places ≥15k population (a light bump over Natural Earth). */
export const DEFAULT_CITIES_TIER: GeonamesTier = "cities15000";

export const isGeonamesTier = (v: unknown): v is GeonamesTier =>
  typeof v === "string" && (GEONAMES_TIERS as readonly string[]).includes(v);

/** A city document ready to insert into the cities collection. */
export interface GeonameCityDoc {
  id: string;
  name: string;
  country: string;
  cc: string;
  region: string;
  lat: number;
  lng: number;
  population: number;
  isCapital: boolean;
  rank: number;
}

/** geoname-table column indices we read. */
const COL = { id: 0, name: 1, asciiname: 2, lat: 4, lng: 5, featureCode: 7, cc: 8, population: 14 };

/** Prominence rank from population (0 = most prominent) — LOD hint for overlays. */
export function rankFromPop(pop: number, isCapital: boolean): number {
  if (isCapital || pop >= 5_000_000) return 0;
  if (pop >= 1_000_000) return 2;
  if (pop >= 500_000) return 4;
  if (pop >= 200_000) return 6;
  if (pop >= 100_000) return 7;
  if (pop >= 50_000) return 8;
  return 9;
}

/**
 * ISO-3166 alpha-2 → country display name, from GeoNames `countryInfo.txt`.
 * Comment/header rows (leading `#`) are skipped; ISO code is col 0, name col 4.
 */
export function parseCountryInfo(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f[0] && f[4]) map.set(f[0], f[4]);
  }
  return map;
}

/**
 * Decoded GeoNames cities TSV → insertable docs. Rows missing a name or valid
 * coordinates are dropped. `isCapital` comes from the `PPLC` feature code; the
 * country display name is joined from `countryNames` (falls back to blank).
 */
export function parseGeonamesCities(
  txt: string,
  countryNames: Map<string, string>,
): GeonameCityDoc[] {
  const out: GeonameCityDoc[] = [];
  for (const line of txt.split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    const name = f[COL.name] || f[COL.asciiname];
    const lat = Number(f[COL.lat]);
    const lng = Number(f[COL.lng]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const cc = (f[COL.cc] || "").slice(0, 4);
    const population = Math.max(0, Math.round(Number(f[COL.population] || 0)));
    const isCapital = f[COL.featureCode] === "PPLC";
    out.push({
      id: `gn-${f[COL.id]}`,
      name: String(name),
      country: countryNames.get(cc) || "",
      cc,
      region: "",
      lat,
      lng,
      population,
      isCapital,
      rank: rankFromPop(population, isCapital),
    });
  }
  return out;
}
