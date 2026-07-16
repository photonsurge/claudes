/**
 * The normalised join key for NAME-matched admin boundaries (China / GADM).
 *
 * CMA (China) warnings ship no geocode and no polygon — only an English county
 * name ("Jinghe County", "Dinghai District"). The only join to a boundary is that
 * name, so the importer and the ingest resolver MUST fold it identically; this is
 * the one place that folding lives, imported by both (the same discipline as
 * `adminKey`). MEASURED against the live feed: this exact folding matches 66% of
 * distinct polygon-less CMA names to a GADM county (72% frequency-weighted). Change
 * it and you change that number — re-measure if you touch it.
 *
 * It lower-cases, strips whitespace, and drops the administrative-type suffix
 * ("County", "City", "District", …) that GADM's `NAME_3` omits but the CMA feed
 * appends. It deliberately does NOT try to fix machine-mistranslations
 * ("Surabaya County" for a Chinese county, "Three gate County" for Sanmen) — those
 * are the ~16% that never match and are left undrawn rather than mis-placed.
 */
const SUFFIX =
  /(autonomousprefecture|autonomousregion|autonomouscounty|prefecture|county|city|district|province|newarea|banner)$/;

export function gadmNameKey(name: string | undefined | null): string {
  const s = String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  return s.replace(SUFFIX, "") || s;
}
