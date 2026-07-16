/**
 * Decode a CAP alert's country from its source-specific identifier and render a
 * "🇨🇭 Switzerland" flag+name label. Pure string work — shared so the worker's
 * director candidates and the public click-to-select card produce identical
 * country text.
 */

/** ISO-3166 alpha-2 → flag emoji (a pair of regional-indicator symbols). */
export const flagOf = (iso2: string): string =>
  iso2.toUpperCase().replace(/[A-Z]/g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));

let regionNames: Intl.DisplayNames | undefined;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = undefined;
}

/**
 * ISO-3166 alpha-2 for an alert, decoded per source convention:
 *  • meteoalarm — a ".XX." segment in the identifier ("2.49.0…AT…").
 *  • WMO SWIC   — the capurl lead "by-belhydromet-en/…" → "by".
 *  • NWS        — US-only.
 */
export function alertCountryCode(a: { source?: string; identifier?: string }): string | undefined {
  const id = a.identifier ?? "";
  const dotted = id.split(".").find((s) => /^[A-Z]{2}$/.test(s));
  if (dotted) return dotted.toUpperCase();
  const lead = id.split("/")[0]?.split("-")[0];
  if (lead && /^[A-Za-z]{2}$/.test(lead)) return lead.toUpperCase();
  if (a.source === "nws") return "US";
  return undefined;
}

/** "Switzerland" from an ISO-3166 alpha-2, falling back to the code itself. */
export const countryNameOf = (iso2: string): string => regionNames?.of(iso2.toUpperCase()) ?? iso2.toUpperCase();

/** "Switzerland" from a CAP alert, or undefined when the country is unknown.
 *  The name alone — sort keys want this, not the flag-prefixed label, since the
 *  leading flag emoji orders by ISO code rather than alphabetically. */
export function alertCountryName(a: { source?: string; identifier?: string }): string | undefined {
  const iso2 = alertCountryCode(a);
  return iso2 ? countryNameOf(iso2) : undefined;
}

/** "🇨🇭 Switzerland" from a CAP alert, or undefined when the country is unknown. */
export function alertCountryLabel(a: { source?: string; identifier?: string }): string | undefined {
  const iso2 = alertCountryCode(a);
  if (!iso2) return undefined;
  return `${flagOf(iso2)} ${countryNameOf(iso2)}`;
}
