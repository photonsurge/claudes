/**
 * Wikipedia REST summary lookup — an exact article title → its lead photo
 * thumbnail + short extract. Keyless. Shared by the city enrichment (prominent
 * cities) and the notable-tracks enrichment (famous aircraft/ships), so both
 * cache the same `{title, extract, thumb}` shape onto their docs and read Mongo
 * at request time, never Wikipedia.
 *
 * Callers MUST cache results and pace calls — Wikipedia's policy requires a
 * descriptive User-Agent (below) and being gentle. Network is injectable for tests.
 */

// Wikipedia's API policy requires a descriptive User-Agent with contact info.
export const WIKI_UA =
  "LiveWeatherGlobe/0.1 (broadcast enrichment; https://github.com/; contact ravergeek@gmail.com)";

export type WikiSummary = { title: string; extract?: string; thumb?: string };

/**
 * Fetch a Wikipedia REST summary for an EXACT title. Returns the summary, or a
 * miss reason ("missing" = no such page, "disambig" = ambiguous) so callers can
 * retry with a more specific title before giving up. Throws on transient HTTP
 * errors so the caller can decide whether to retry.
 */
export async function fetchWikiSummary(
  title: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WikiSummary | "missing" | "disambig"> {
  const slug = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}?redirect=true`;
  const res = await fetchImpl(url, { headers: { "User-Agent": WIKI_UA, accept: "application/json" } });
  if (res.status === 404) return "missing";
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = await res.json();
  if (typeof j?.type === "string" && j.type.includes("disambiguation")) return "disambig";
  return {
    title: j?.title ?? title,
    extract: typeof j?.extract === "string" && j.extract.trim() ? j.extract.trim() : undefined,
    thumb: j?.thumbnail?.source,
  };
}
