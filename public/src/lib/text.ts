/**
 * On-air text trimming. Wikipedia extracts run long, and a CSS line-clamp cuts
 * them mid-sentence ("…before adopting the name…") — which reads badly on a
 * broadcast card. clampSentences pre-trims to whole sentences within a budget
 * so the clamp (kept as a safety net) rarely fires.
 */

/** Sentence enders (optionally wrapped in a closing quote/bracket) followed by
 *  whitespace and a capital/digit/opening-quote — the capital requirement keeps
 *  abbreviations like "U.S. state" from counting as a boundary. */
const SENTENCE_END = /[.!?…]+["')\]»”]?(?=\s+["'(\[«“]?[A-Z0-9])/g;

/**
 * Trim `text` to the most complete sentences that fit `maxChars`. If not even
 * the first sentence fits, fall back to a word-boundary cut + ellipsis so we
 * never overflow the budget.
 */
export function clampSentences(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;

  let out = "";
  for (const m of t.matchAll(SENTENCE_END)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end > maxChars) break;
    out = t.slice(0, end);
  }
  if (out) return out;

  // No sentence boundary inside the budget: cut at the last word that fits.
  const cut = t.lastIndexOf(" ", maxChars - 1);
  return `${t.slice(0, cut > 40 ? cut : maxChars).trimEnd()}…`;
}
