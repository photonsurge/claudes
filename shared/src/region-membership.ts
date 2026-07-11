/**
 * Region ↔ country membership — the CURATED relations that power the region
 * dossier (countries within a region, its biggest cities, and the reverse
 * "which regions is this country in"). Deliberately NOT bbox-derived: a bounding
 * box bleeds across borders (Kazakhstan landing in a "China" box) and can't
 * express that a country belongs to several regions at once. Membership here is
 * explicit, so Egypt is in `africa`, `maghreb` AND (were it curated) more.
 *
 * Three membership kinds:
 *   1. Continents  — resolved from the Country catalog's Natural Earth `continent`
 *      field (authoritative, no hand-listing 50+ countries). See CONTINENT_LABEL.
 *   2. Country-grouping sub-regions — an explicit ISO-2 list; membership is exactly
 *      those countries (whole countries). See SUBREGION_COUNTRIES.
 *   3. bbox-scoped bands — geographic areas that cut BELOW national level (US West,
 *      Siberia, Amazonia): a city/point belongs iff its country is listed AND it
 *      falls inside the region's bbox. See BBOX_SCOPED_COUNTRIES.
 *
 * Oceans/seas get no membership (land only). ISO-2 codes are lowercase here;
 * callers normalise to the City/Country catalogs' casing.
 *
 * The country lists below are a curated first pass — tune freely, they're the one
 * place membership is defined.
 */

/** Land regions whose membership is the Natural Earth `continent` string. */
export const CONTINENT_LABEL: Record<string, string> = {
  north_america: "North America",
  south_america: "South America",
  europe: "Europe",
  africa: "Africa",
  asia: "Asia",
  oceania: "Oceania",
};

/** Sub-regions defined by a whole-country grouping (no bbox test). */
export const SUBREGION_COUNTRIES: Record<string, string[]> = {
  // Europe
  uk: ["gb"],
  scandinavia: ["no", "se", "fi", "dk", "is"],
  iberia: ["es", "pt", "ad"],
  central_europe: ["de", "at", "ch", "li", "cz", "sk", "si", "hu", "pl"],
  balkans: ["hr", "ba", "rs", "me", "xk", "mk", "al", "bg", "gr", "ro"],
  eastern_europe: ["ua", "by", "md", "lt", "lv", "ee", "ru"],
  // Asia (sub-continental groupings — Asia the continent is derived separately)
  east_asia: ["cn", "jp", "kr", "kp", "mn", "tw"],
  south_asia: ["in", "pk", "bd", "np", "bt", "lk", "mv"],
  middle_east: ["tr", "sy", "lb", "il", "ps", "jo", "iq", "ir", "sa", "ye", "om", "ae", "qa", "bh", "kw"],
  central_asia: ["kz", "uz", "tm", "kg", "tj"],
  southeast_asia: ["th", "vn", "kh", "la", "mm", "my", "sg", "id", "ph", "bn", "tl"],
  // Africa
  west_africa: ["sn", "gm", "gw", "gn", "sl", "lr", "ci", "gh", "tg", "bj", "ng", "bf", "ml", "cv"],
  horn_of_africa: ["et", "er", "dj", "so", "ss", "sd"],
  southern_africa: ["za", "na", "bw", "zw", "zm", "mz", "ls", "sz", "mw", "ao"],
  // Oceania (island nations — Oceania the continent is derived separately)
  new_zealand: ["nz"],
  pacific_islands: ["pg", "fj", "sb", "vu", "nc", "pf", "ws", "to", "ki", "fm", "mh", "nr", "pw", "tv"],
};

/**
 * Sub-national / cross-cutting bands. Membership = country in this list AND the
 * city/point inside the region bbox. Multiple countries are allowed (a band like
 * the Sahel or the Andes spans several) — the bbox does the sub-national cut that
 * a country list can't. None of these cross the antimeridian, so a plain bbox
 * test is safe.
 */
export const BBOX_SCOPED_COUNTRIES: Record<string, string[]> = {
  // North America (intra-national)
  pacific_nw: ["us", "ca"],
  us_west: ["us"],
  us_plains: ["us"],
  us_northeast: ["us", "ca"],
  us_gulf_southeast: ["us"],
  great_lakes: ["us", "ca"],
  // Asia
  siberia: ["ru"],
  // Africa (the Sahel belt cuts the north off several West/Central-African states)
  maghreb: ["ma", "dz", "tn", "ly", "mr", "eh", "eg"],
  sahel: ["mr", "ml", "ne", "td", "sd", "sn", "bf", "ng", "cm"],
  // South America
  amazonia: ["br", "pe", "co", "ec", "bo", "ve", "gy", "sr", "gf"],
  andes: ["co", "ec", "pe", "bo", "cl", "ar", "ve"],
  southern_cone: ["ar", "cl", "uy", "py"],
  // Oceania
  se_australia: ["au"],
};

/** A region whose city/point membership is additionally constrained by its bbox. */
export const isBboxScoped = (regionId: string): boolean =>
  Object.prototype.hasOwnProperty.call(BBOX_SCOPED_COUNTRIES, regionId);

/** Land region groups get a dossier; oceans/seas get nothing. */
export const isLandGroup = (group: string): boolean => group !== "ocean";

/**
 * The member country ISO-2 codes (lowercase) of a region. Continents read from
 * the passed Country catalog (`continent` field); sub-regions/bands from the
 * curated lists above. Returns [] for oceans, `world`, or anything uncurated.
 */
export function memberCountryCodes(
  regionId: string,
  countries: { iso2?: string; continent?: string }[],
): string[] {
  const continent = CONTINENT_LABEL[regionId];
  if (continent) {
    return countries
      .filter((c) => c.continent === continent && c.iso2)
      .map((c) => c.iso2!.toLowerCase());
  }
  const list = SUBREGION_COUNTRIES[regionId] ?? BBOX_SCOPED_COUNTRIES[regionId] ?? [];
  return list.map((c) => c.toLowerCase());
}

/**
 * Reverse relation: the region ids a country belongs to — its continent plus
 * every curated sub-region/band that lists it. bbox-scoped bands are included at
 * country granularity (they're a rough "this country touches the band"); a
 * point-accurate answer needs the coordinate + bbox, done at query time.
 */
export function regionsForCountry(iso2: string, continent?: string): string[] {
  const cc = iso2.toLowerCase();
  const out: string[] = [];
  for (const [rid, label] of Object.entries(CONTINENT_LABEL)) {
    if (continent && continent === label) out.push(rid);
  }
  for (const [rid, list] of Object.entries(SUBREGION_COUNTRIES)) {
    if (list.includes(cc)) out.push(rid);
  }
  for (const [rid, list] of Object.entries(BBOX_SCOPED_COUNTRIES)) {
    if (list.includes(cc)) out.push(rid);
  }
  return out;
}
