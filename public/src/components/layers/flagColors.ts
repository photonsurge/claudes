/**
 * Flag-colour palettes for the country spotlight glow, keyed by ISO-3166
 * alpha-2 (the same `iso_a2` countries.geojson carries and director-countries'
 * `iso2` joins to). Covers the director `country` catalog (the countries that
 * actually air as spotlights); anything off-catalog resolves to null and the
 * glow falls back to plain white.
 *
 * Each palette is the flag's main bands, ordered so the glow reads naturally as
 * it cycles through them (countryGlow's `cyclePalette`). "Black" bands are kept
 * authentic — countryGlow lightens every glow pass toward white, so they render
 * as a visible grey rather than vanishing.
 */

/** Minimal "#rrggbb" → [r,g,b]; self-contained so this data module pulls in no
 *  deck/layer imports. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace(/^#/, ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** ISO2 → ordered flag hex colours. */
export const FLAG_COLORS: Record<string, string[]> = {
  US: ["#B22234", "#FFFFFF", "#3C3B6E"],
  CA: ["#D80621", "#FFFFFF"],
  MX: ["#006847", "#FFFFFF", "#CE1126"],
  BR: ["#009C3B", "#FFDF00", "#002776"],
  AR: ["#74ACDF", "#FFFFFF", "#F6B40E"],
  CL: ["#0039A6", "#FFFFFF", "#D52B1E"],
  IS: ["#02529C", "#FFFFFF", "#DC1E35"],
  IE: ["#169B62", "#FFFFFF", "#FF883E"],
  GB: ["#C8102E", "#FFFFFF", "#012169"],
  PT: ["#006600", "#FF0000", "#FFCC00"],
  ES: ["#AA151B", "#F1BF00"],
  FR: ["#0055A4", "#FFFFFF", "#EF4135"],
  DE: ["#000000", "#DD0000", "#FFCE00"],
  IT: ["#009246", "#FFFFFF", "#CE2B37"],
  NO: ["#EF2B2D", "#FFFFFF", "#002868"],
  SE: ["#006AA7", "#FECC00"],
  GR: ["#0D5EAF", "#FFFFFF"],
  TR: ["#E30A17", "#FFFFFF"],
  EG: ["#CE1126", "#FFFFFF", "#000000"],
  ZA: ["#007A4D", "#FFB915", "#DE3831", "#002395"],
  IN: ["#FF9933", "#FFFFFF", "#138808"],
  CN: ["#DE2910", "#FFDE00"],
  TH: ["#A51931", "#FFFFFF", "#241D4F"],
  VN: ["#DA251D", "#FFFF00"],
  KR: ["#CD2E3A", "#FFFFFF", "#0047A0"],
  JP: ["#BC002D", "#FFFFFF"],
  PH: ["#0038A8", "#CE1126", "#FCD116"],
  ID: ["#FF0000", "#FFFFFF"],
  AU: ["#012169", "#E4002B", "#FFFFFF"],
  NZ: ["#00247D", "#CC142B", "#FFFFFF"],
};

/** The flag palette (as rgb tuples) for an ISO2, or null when we have none. */
export function flagPaletteFor(iso2: string | null | undefined): [number, number, number][] | null {
  const hexes = FLAG_COLORS[String(iso2 ?? "").toUpperCase()];
  return hexes ? hexes.map(hexToRgb) : null;
}
