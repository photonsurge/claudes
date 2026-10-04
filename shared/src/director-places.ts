/**
 * Free-text place names → the director's own shots: "japan", "UK", "the alps",
 * "Iberia" resolve to a country spotlight or an area tour. Used by operator
 * "Go to…" and (under chat policy) viewer `:show japan` / `:roundup uk`.
 * Cities are resolved separately against the City collection in the worker.
 *
 * Matching is forgiving (case, accents, punctuation, a leading "the", common
 * aliases) but never fuzzy across words: an exact hit beats a prefix hit beats a
 * word-prefix hit, and a country beats an area on a tie.
 */
import { COUNTRY_SHOTS, type CountryShot } from "./director-countries";
import { REGION_SHOTS, type RegionShot } from "./director-regions";

export type PlaceMatch = { kind: "country"; shot: CountryShot } | { kind: "region"; shot: RegionShot };

/** Extra names people use for the curated countries (keyed by shot id). */
export const COUNTRY_ALIASES: Record<string, string[]> = {
  usa: ["us", "america", "united states of america", "the states"],
  uk: ["britain", "great britain", "united kingdom", "gb"],
  "south-africa": ["rsa"],
  "south-korea": ["korea"],
  "new-zealand": ["nz", "aotearoa"],
  uae: ["emirates", "united arab emirates"],
};

/** Lowercase, strip accents and punctuation, collapse spaces, drop a leading "the". */
export function normalisePlace(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

interface Entry {
  match: PlaceMatch;
  names: string[];
}

let entries: Entry[] | null = null;
function catalog(): Entry[] {
  if (entries) return entries;
  entries = [
    ...COUNTRY_SHOTS.map((shot) => ({
      match: { kind: "country" as const, shot },
      names: [shot.name, shot.id, shot.iso2, ...(COUNTRY_ALIASES[shot.id] ?? [])].map(normalisePlace),
    })),
    ...REGION_SHOTS.map((shot) => ({
      match: { kind: "region" as const, shot },
      names: [shot.name, shot.id].map(normalisePlace),
    })),
  ];
  return entries;
}

/** 3 = exact, 2 = the name starts with the query, 1 = a word in the name does, 0 = no match. */
function score(names: string[], q: string): number {
  let best = 0;
  for (const n of names) {
    if (n === q) return 3;
    if (q.length >= 3 && n.startsWith(q)) best = Math.max(best, 2);
    else if (q.length >= 3 && n.split(" ").some((w) => w.startsWith(q))) best = Math.max(best, 1);
  }
  return best;
}

/** The best country / area for a free-text query, or null. */
export function resolvePlaceQuery(query: string): PlaceMatch | null {
  const q = normalisePlace(query);
  if (!q) return null;
  let best: { s: number; e: Entry } | null = null;
  for (const e of catalog()) {
    const s = score(e.names, q);
    if (!s) continue;
    const better =
      !best ||
      s > best.s ||
      (s === best.s && e.match.kind === "country" && best.e.match.kind === "region") ||
      (s === best.s && e.match.kind === best.e.match.kind && e.match.shot.name.length < best.e.match.shot.name.length);
    if (better) best = { s, e };
  }
  return best?.e.match ?? null;
}

/** The curated country shot behind a Country doc id (iso2, lowercased) — how
 *  country round-ups are keyed. */
export function countryShotForCountryId(countryId: string): CountryShot | undefined {
  const iso = countryId.toUpperCase();
  return COUNTRY_SHOTS.find((s) => s.iso2 === iso);
}
