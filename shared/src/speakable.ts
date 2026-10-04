/**
 * Rewrite on-screen text for the ear before it goes to a speech model
 * (docs/presenter-plan.md §7). Deterministic, so pronunciation does not
 * depend on which speech model reads it: "M5.6" is "magnitude 5.6" in every
 * voice, "120 km/h" is "120 kilometres per hour".
 *
 * Conservative by design: only patterns that are unambiguous in this
 * channel's text are rewritten. Anything else is left for the model.
 */

const UNIT_WORDS: Array<[RegExp, string]> = [
  // Order matters: longer units before their prefixes (km/h before km).
  [/(\d)\s*km\/h\b/gi, "$1 kilometres per hour"],
  [/(\d)\s*kph\b/gi, "$1 kilometres per hour"],
  [/(\d)\s*mph\b/gi, "$1 miles per hour"],
  [/(\d)\s*m\/s\b/gi, "$1 metres per second"],
  [/(\d)\s*kts?\b/gi, "$1 knots"],
  [/(\d)\s*°\s*C\b/g, "$1 degrees Celsius"],
  [/(\d)\s*°\s*F\b/g, "$1 degrees Fahrenheit"],
  [/(\d)\s*°/g, "$1 degrees"],
  [/(\d)\s*hPa\b/g, "$1 hectopascals"],
  [/(\d)\s*mb\b/g, "$1 millibars"],
  [/(\d)\s*mm\b/g, "$1 millimetres"],
  [/(\d)\s*cm\b/g, "$1 centimetres"],
  [/(\d)\s*km\b/gi, "$1 kilometres"],
  [/(\d)\s*ft\b/g, "$1 feet"],
  [/(\d)\s*%/g, "$1 percent"],
];

/** Emoji, pictographs, regional-indicator flags, variation selectors and joiners. */
const EMOJI = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F000}-\u{1F2FF}]/gu;

export function speakable(input: string): string {
  let t = input ?? "";

  // Markdown and markup that would be read aloud or spelled out.
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // [label](url) → label
  t = t.replace(/https?:\/\/\S+/g, "");
  t = t.replace(/[*_`#>]+/g, "");
  t = t.replace(EMOJI, "");

  // Earthquake magnitude: "M5.6", "M 5.6", "Mw 6.1", "magnitude-5.6".
  t = t.replace(/\bM[wlbs]?\s?(\d+(?:\.\d+)?)\b/g, "magnitude $1");

  // Ranges and approximations: "10–20" → "10 to 20", "~30" → "about 30".
  t = t.replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2");
  // Hyphen ranges only between short numbers, so dates ("2026-10-04") are left alone.
  t = t.replace(/(?<![\d-])(\d{1,3})-(\d{1,3})(?![\d-])/g, "$1 to $2");
  t = t.replace(/~\s*(\d)/g, "about $1");
  t = t.replace(/(^|\s)±\s*(\d)/g, "$1plus or minus $2");

  // Signs on temperatures and deltas: "-5 °C" → "minus 5 …", "+3" → "plus 3".
  t = t.replace(/(^|[\s(])[-−](\d)/g, "$1minus $2");
  t = t.replace(/(^|[\s(])\+(\d)/g, "$1plus $2");

  for (const [rx, rep] of UNIT_WORDS) t = t.replace(rx, rep);

  // Time zone and common abbreviations spelled for the ear.
  t = t.replace(/\bUTC\b/g, "U T C");
  t = t.replace(/\bGMT\b/g, "G M T");
  t = t.replace(/\bvs\.?(?=\s)/gi, "versus");
  t = t.replace(/\betc\./gi, "et cetera");
  t = t.replace(/\be\.g\./gi, "for example");
  t = t.replace(/\bi\.e\./gi, "that is");
  t = t.replace(/&/g, " and ");

  // Brackets read as pauses rather than "open bracket".
  t = t.replace(/\s*[([]\s*/g, ", ").replace(/\s*[)\]]\s*/g, ", ");
  t = t.replace(/(\p{L})\s*\/\s*(\p{L})/gu, "$1 or $2");

  // Tidy: line breaks become sentence breaks, collapse runs.
  t = t.replace(/\s*\n\s*\n\s*/g, ". ").replace(/\s*\n\s*/g, " ");
  t = t.replace(/\s+/g, " ");
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/,\s*,+/g, ",").replace(/([.!?])\s*[.,]+/g, "$1").replace(/,\s*([.!?])/g, "$1");
  return t.replace(/^[\s,.;:]+/, "").trim();
}
