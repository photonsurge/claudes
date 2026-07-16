/**
 * Language rules shared by the ingest normaliser and the translate job, so
 * "what counts as already-English" is decided in exactly one place. The point:
 * only spend an LLM call when an alert has NO English rendering anywhere —
 * neither a CAP `<info language="en">` block nor a WMO SWIC English edition.
 */

/** CAP `language` (ISO 639-1, e.g. "en", "en-US", "en-GB") denoting English. */
export function isEnglishLang(language?: string): boolean {
  const l = language?.trim().toLowerCase();
  if (!l) return false;
  return l === "en" || l.startsWith("en-") || l.startsWith("en_");
}

/**
 * WMO SWIC keys each alert by a `capurl` whose authority segment carries the
 * edition language as its final suffix — `kz-kazhydromet-en/2026/…` (English),
 * `pl-imgw-xx/…` (unknown), `ru-meteo-ru/…` (native). The WFS feed has no CAP
 * `<language>`, so this suffix is the only English signal for WMO alerts.
 */
export function wmoAuthorityIsEnglish(identifier?: string): boolean {
  const authority = (identifier ?? "").split("/")[0] ?? "";
  return authority.split("-").pop()?.toLowerCase() === "en";
}

/** Does this alert already carry at least one English-language info block? */
export function hasEnglishInfo<T extends { language?: string }>(info: T[]): boolean {
  return info.some((i) => isEnglishLang(i.language));
}

/**
 * When an alert carries an English info block alongside national-language
 * duplicates (MeteoAlarm ships one `<info>` per language), keep only the
 * English block(s). Everything on-air is positional (`info[0]`) and English-
 * only, so the national dupes are never displayed and only cost an LLM call to
 * translate. Alerts with no English block are returned unchanged — those still
 * need translating.
 */
export function collapseToEnglish<T extends { language?: string }>(info: T[]): T[] {
  if (info.length <= 1 || !hasEnglishInfo(info)) return info;
  return info.filter((i) => isEnglishLang(i.language));
}
