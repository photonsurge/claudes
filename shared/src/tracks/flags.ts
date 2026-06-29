/**
 * Country + flag helpers for live tracks.
 *  - Ships: the first 3 MMSI digits are the Maritime Identification Digits (MID)
 *    → registration country. Derived locally, no feed call.
 *  - Aircraft: OpenSky already gives `origin_country` as a name; we map the
 *    common ones to a flag.
 * Unknowns degrade gracefully (no flag / no country) rather than guessing.
 */

/** ISO-3166 alpha-2 → 🇽🇾 regional-indicator flag emoji. "" for bad input. */
export function isoToFlag(iso2: string | undefined): string {
  if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) return "";
  const cc = iso2.toUpperCase();
  return String.fromCodePoint(
    0x1f1e6 + cc.charCodeAt(0) - 65,
    0x1f1e6 + cc.charCodeAt(1) - 65,
  );
}

/** ISO2 → display name (the subset we resolve). */
const ISO2_NAME: Record<string, string> = {
  GB: "United Kingdom", IE: "Ireland", US: "United States", CA: "Canada",
  FR: "France", DE: "Germany", NL: "Netherlands", BE: "Belgium", LU: "Luxembourg",
  ES: "Spain", PT: "Portugal", IT: "Italy", CH: "Switzerland", AT: "Austria",
  DK: "Denmark", NO: "Norway", SE: "Sweden", FI: "Finland", IS: "Iceland",
  PL: "Poland", CZ: "Czechia", SK: "Slovakia", HU: "Hungary", RO: "Romania",
  BG: "Bulgaria", GR: "Greece", HR: "Croatia", SI: "Slovenia", RS: "Serbia",
  UA: "Ukraine", RU: "Russia", TR: "Turkey", EE: "Estonia", LV: "Latvia",
  LT: "Lithuania", CY: "Cyprus", MT: "Malta", AL: "Albania",
  CN: "China", JP: "Japan", KR: "South Korea", IN: "India", ID: "Indonesia",
  SG: "Singapore", MY: "Malaysia", TH: "Thailand", VN: "Vietnam", PH: "Philippines",
  HK: "Hong Kong", TW: "Taiwan", AU: "Australia", NZ: "New Zealand",
  AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", IL: "Israel",
  EG: "Egypt", MA: "Morocco", DZ: "Algeria", TN: "Tunisia", ZA: "South Africa",
  NG: "Nigeria", KE: "Kenya", BR: "Brazil", AR: "Argentina", CL: "Chile",
  MX: "Mexico", CO: "Colombia", PA: "Panama", LR: "Liberia", MH: "Marshall Islands",
  BS: "Bahamas", BM: "Bermuda", KY: "Cayman Islands", MC: "Monaco",
};

/** MMSI MID (first 3 digits) → ISO2. Covers the high-traffic flags. */
const MID_ISO2: Record<string, string> = {
  "232": "GB", "233": "GB", "234": "GB", "235": "GB",
  "250": "IE", "227": "FR", "228": "FR", "229": "MT", "248": "MT", "249": "MT", "256": "MT",
  "211": "DE", "218": "DE", "244": "NL", "245": "NL", "246": "NL", "205": "BE",
  "224": "ES", "225": "ES", "263": "PT", "204": "PT",
  "247": "IT", "269": "CH", "203": "AT", "219": "DK", "220": "DK",
  "257": "NO", "258": "NO", "259": "NO", "265": "SE", "266": "SE", "230": "FI",
  "251": "IS", "261": "PL", "270": "CZ", "243": "HU", "264": "RO", "207": "BG",
  "237": "GR", "239": "GR", "240": "GR", "241": "GR", "238": "HR",
  "278": "SI", "279": "RS",
  "272": "UA", "273": "RU", "271": "TR", "276": "EE", "275": "LV", "277": "LT",
  "209": "CY", "210": "CY", "212": "CY",
  "412": "CN", "413": "CN", "414": "CN", "431": "JP", "432": "JP",
  "440": "KR", "441": "KR", "419": "IN", "525": "ID", "563": "SG", "564": "SG",
  "565": "SG", "566": "SG", "533": "MY", "567": "TH", "574": "VN", "548": "PH",
  "477": "HK", "416": "TW", "503": "AU", "512": "NZ",
  "470": "AE", "471": "AE", "403": "SA", "466": "QA", "428": "IL",
  "622": "EG", "242": "MA", "605": "DZ", "672": "TN", "601": "ZA",
  "657": "NG", "634": "KE", "710": "BR", "701": "AR", "725": "CL",
  "345": "MX", "730": "CO", "351": "PA", "352": "PA", "353": "PA", "354": "PA",
  "636": "LR", "637": "LR", "538": "MH", "311": "BS", "310": "BM", "319": "KY", "254": "MC",
  "338": "US", "366": "US", "367": "US", "368": "US", "369": "US", "303": "US",
  "316": "CA",
};

/** OpenSky origin_country name → ISO2 (the common ones, for the flag). */
const NAME_ISO2: Record<string, string> = Object.fromEntries(
  Object.entries(ISO2_NAME).map(([iso, name]) => [name, iso]),
);

export interface CountryInfo {
  /** Display name, e.g. "United Kingdom". */
  name: string;
  /** Flag emoji, or "" if unresolved. */
  flag: string;
}

/** Resolve a ship's registration country from its MMSI. */
export function mmsiCountry(mmsi: string | undefined): CountryInfo | undefined {
  if (!mmsi) return undefined;
  const iso = MID_ISO2[String(mmsi).slice(0, 3)];
  if (!iso) return undefined;
  return { name: ISO2_NAME[iso] ?? iso, flag: isoToFlag(iso) };
}

/** Resolve a flag for an aircraft's origin_country name (or "" if unknown). */
export function countryNameFlag(name: string | undefined): string {
  if (!name) return "";
  return isoToFlag(NAME_ISO2[name]);
}
