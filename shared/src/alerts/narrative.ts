/**
 * A warning's own WORDS, shaped for air.
 *
 * Everything the broadcast said about a storm came from our own vocabulary — the
 * phrasebook title, the hazard type, the severity rank, a rollup of what else was
 * nearby. The CAP message's actual content (what is happening, and what people
 * there are told to do) reached `/admin` and stopped: nothing under `/watch` ever
 * read `description` or `instruction`. A viewer got "SEVERE · Extreme Rainfall ·
 * 4/4" and no detail at all.
 *
 * This is the pure builder that turns one CAP `info` block into the on-air
 * narrative. Two jobs beyond copying strings:
 *
 *  • TRANSLATION PREFERENCE — the worker translates non-English bulletins in
 *    place (`translated*`), leaving those fields empty when the source was
 *    already English. So "prefer the translation, else the original" is the only
 *    correct read; a consumer that reads `translatedDescription` alone shows
 *    nothing for every English-language feed.
 *
 *  • THE areaDesc DUMP — CAP lets a source put its entire footprint in ONE
 *    `areaDesc` string, and several do: a WMO bulletin ships "Asir region - Abha
 *    : The entire governorate; Asir region - Ahad Rufaydah : The entire
 *    governorate; …" as a single field. Rendered raw that is an unreadable
 *    run-on that gets clamped mid-word on a card. Split it back into the list it
 *    always was, so a card can show the areas as rows and a subtitle can name
 *    the first one and count the rest.
 */

/** The CAP info block this reads — structural, so `iAlertInfo`, the public
 *  `AlertInfo` mirror and a test literal all satisfy it. */
export interface NarrativeInfo {
  headline?: string;
  description?: string;
  instruction?: string;
  /** CAP urgency — Immediate / Expected / Future. */
  urgency?: string;
  /** CAP certainty — Observed / Likely / Possible. */
  certainty?: string;
  /** CAP category — Met / Marine / Geo / Health… */
  category?: string[];
  /** The authority's own page for this warning. */
  web?: string;
  translatedHeadline?: string;
  translatedDescription?: string;
  translatedInstruction?: string;
  /** LLM-detected source language ("ar"), when the text was translated. */
  detectedLanguage?: string;
  area?: { areaDesc?: string }[];
}

/** The message-level fields around the info block (they live on the alert doc,
 *  not inside `info`). */
export interface NarrativeMessage {
  /** The issuing authority's own name — "Saudi Arabia NCM", not "WMO". Every
   *  adapter fills this: it's the body that actually put the warning out, which
   *  is who a viewer should be told is warning them. */
  sender?: string;
  /** CAP msgType — "Alert" first time, then "Update" / "Cancel". */
  msgType?: string;
}

/** The on-air narrative of one warning. */
export interface AlertNarrative {
  /** The source's own headline (translated when it wasn't English). */
  headline?: string;
  /** What is happening — the CAP description. */
  description?: string;
  /** What people there are told to do — the CAP instruction. */
  instruction?: string;
  /** The named areas, split out of the areaDesc dump, capped at
   *  {@link MAX_NARRATIVE_AREAS} and de-duplicated. */
  areas: string[];
  /** How many areas there really are (`areas` is capped). */
  areaCount: number;
  /** True when the text shown is a translation rather than the source's words. */
  translated: boolean;
  /** The source language a translation came from ("ar"), when known. */
  language?: string;
  /** The issuing authority's name, when it adds something past the feed name. */
  sender?: string;
  /** How urgent the authority says this is (Immediate / Expected / Future). */
  urgency?: string;
  /** How sure the authority is (Observed / Likely / Possible). */
  certainty?: string;
  /** CAP categories (Met, Marine, Geo…) — "Unknown" dropped. */
  categories: string[];
  /** Set only when this is NOT a first bulletin — "Update", "Cancel". */
  msgType?: string;
  /** The authority's page for this warning. */
  web?: string;
}

/** How many areas a narrative carries. A card shows a handful and counts the
 *  rest; the cap is what keeps a 300-county Spanish alert from riding the
 *  focus bundle as 300 strings. */
export const MAX_NARRATIVE_AREAS = 12;

/** Longest place label a card subtitle takes before it reads as a run-on. */
const MAX_PLACE_LABEL = 64;

/**
 * A CAP enumerated value worth showing. CAP spells "no value" as the literal
 * "Unknown" rather than omitting the element, and every adapter passes that
 * through — so a card that renders the field raw prints "URGENCY Unknown",
 * which is worse than printing nothing.
 */
function enumValue(v?: string): string | undefined {
  const t = v?.trim();
  if (!t || t.toLowerCase() === "unknown") return undefined;
  return t;
}

/** Prefer the translation, fall back to the source's own words; undefined when
 *  neither carries anything (both are routinely "" rather than absent). */
function preferred(translated?: string, original?: string): string | undefined {
  const t = translated?.trim();
  if (t) return t;
  const o = original?.trim();
  return o || undefined;
}

/**
 * A CAP `areaDesc` split back into the list of places it names.
 *
 * Sources joining a whole footprint into one field use `;` (WMO) or newlines;
 * entries are trimmed, blanks dropped, and repeats removed case-insensitively
 * (a bulletin naming the same governorate per district is common). A plain
 * single-area string comes back as a one-entry list, so callers need no branch.
 */
export function splitAreaDesc(areaDesc?: string | null): string[] {
  if (!areaDesc) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of areaDesc.split(/[;\n]+/)) {
    const entry = raw.trim().replace(/[,\s]+$/, "");
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * The lead place name for a card subtitle, plus how many other areas the same
 * `areaDesc` named.
 *
 * Trims the qualifier some feeds append to each entry ("Asir region - Abha :
 * The entire governorate" → "Asir region - Abha"): a SPACED colon, which reads
 * as a label/value seam rather than punctuation inside a name. A long lead is
 * cut at a word boundary rather than mid-word.
 */
export function areaPlaceLabel(areaDesc?: string | null): { label?: string; more: number } {
  const areas = splitAreaDesc(areaDesc);
  if (!areas.length) return { more: 0 };
  let label = areas[0];
  const seam = label.indexOf(" : ");
  if (seam > 0) label = label.slice(0, seam).trim();
  if (label.length > MAX_PLACE_LABEL) {
    const cut = label.slice(0, MAX_PLACE_LABEL);
    const space = cut.lastIndexOf(" ");
    label = `${(space > MAX_PLACE_LABEL / 2 ? cut.slice(0, space) : cut).trim()}…`;
  }
  return { label: label || undefined, more: areas.length - 1 };
}

/**
 * The on-air narrative of one CAP info block, or null when it says nothing we
 * can put on screen (no headline, no description, no instruction, no areas —
 * a geocode-only stub).
 *
 * `areas` are gathered across EVERY area of the block, because the two shapes
 * mean the same thing to a viewer: one area holding a semicolon-joined dump and
 * a hundred areas holding one name each are both "the places under this warning".
 */
export function buildAlertNarrative(
  info?: NarrativeInfo | null,
  message?: NarrativeMessage | null,
): AlertNarrative | null {
  if (!info) return null;
  const headline = preferred(info.translatedHeadline, info.headline);
  const description = preferred(info.translatedDescription, info.description);
  const instruction = preferred(info.translatedInstruction, info.instruction);

  const seen = new Set<string>();
  const areas: string[] = [];
  let areaCount = 0;
  for (const area of info.area ?? []) {
    for (const name of splitAreaDesc(area.areaDesc)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      areaCount++;
      if (areas.length < MAX_NARRATIVE_AREAS) areas.push(name);
    }
  }

  if (!headline && !description && !instruction && !areaCount) return null;

  const translated = Boolean(
    (info.translatedHeadline?.trim() && info.translatedHeadline.trim() !== info.headline?.trim()) ||
      (info.translatedDescription?.trim() && info.translatedDescription.trim() !== info.description?.trim()) ||
      (info.translatedInstruction?.trim() && info.translatedInstruction.trim() !== info.instruction?.trim()),
  );

  // The aggregator's name is already on the card ("SOURCE WMO"); the authority
  // behind it is not, and is the more honest attribution.
  const sender = message?.sender?.trim() || undefined;
  const msgType = message?.msgType?.trim();

  return {
    headline,
    description,
    instruction,
    areas,
    areaCount,
    translated,
    language: translated ? info.detectedLanguage : undefined,
    sender,
    urgency: enumValue(info.urgency),
    certainty: enumValue(info.certainty),
    categories: (info.category ?? []).map((c) => enumValue(c)).filter((c): c is string => !!c),
    // A plain first bulletin needs no badge; an update or a cancellation does.
    msgType: msgType && msgType.toLowerCase() !== "alert" ? msgType : undefined,
    web: info.web?.trim() || undefined,
  };
}

/** Whether a narrative has PROSE worth a slide of its own — the areas list
 *  alone already rides the lede's subtitle, so it doesn't earn one. */
export function hasNarrativeProse(n?: AlertNarrative | null): boolean {
  return Boolean(n && (n.description || n.instruction || n.headline));
}
