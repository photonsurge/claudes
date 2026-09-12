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
  /** GeoJSON [lng, lat] for the 2dsphere `loc` index (see city-model.ts). */
  loc: { type: "Point"; coordinates: [number, number] };
  population: number;
  isCapital: boolean;
  rank: number;
  /** IANA zone id from the gazetteer's timezone column ("Asia/Tokyo"). Drives
   *  the on-air "local time here" reading — real, so it survives DST and the
   *  half-hour offsets a longitude guess gets wrong. Empty for the rare row
   *  that ships without one. */
  timezone?: string;
}

/** geoname-table column indices we read. */
const COL = { id: 0, name: 1, asciiname: 2, lat: 4, lng: 5, featureCode: 7, cc: 8, population: 14, timezone: 17 };

/** Shape check for a gazetteer timezone cell — "Area/Place" (optionally a third
 *  segment, e.g. "America/Argentina/Salta"), letters, digits, `_`, `-`, `+`.
 *  A blank or mangled cell is dropped rather than stored and failed on later. */
export function isIanaZoneId(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(value);
}

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
 * PURE: geonames id + IANA zone from ONE geoname-table row, or null when the row
 * carries no usable zone.
 *
 * The lean read the timezone backfill needs: it walks a 200k-row dump without
 * ever building a city doc per row, so the scan can be chunked across ticks
 * instead of blocking the worker loop (see worker/src/jobs/cities.ts).
 */
export function parseGeonameZoneRow(line: string): { id: string; timezone: string } | null {
  if (!line) return null;
  const f = line.split("\t");
  const id = f[COL.id];
  const tz = (f[COL.timezone] || "").trim();
  if (!id || !isIanaZoneId(tz)) return null;
  return { id: `gn-${id}`, timezone: tz };
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
    // Trailing \r survives a CRLF dump and would poison every Intl lookup, so
    // the id is trimmed and sanity-checked ("Region/City") before it is kept.
    const tz = (f[COL.timezone] || "").trim();
    out.push({
      id: `gn-${f[COL.id]}`,
      name: String(name),
      country: countryNames.get(cc) || "",
      cc,
      region: "",
      lat,
      lng,
      loc: { type: "Point", coordinates: [lng, lat] },
      population,
      isCapital,
      rank: rankFromPop(population, isCapital),
      ...(isIanaZoneId(tz) ? { timezone: tz } : {}),
    });
  }
  return out;
}
