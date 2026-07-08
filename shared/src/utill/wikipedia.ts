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

export type WikiSummary = { title: string; extract?: string; thumb?: string; photo?: string };

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
    // Full-resolution version of the same lead image — the summary endpoint's
    // `thumbnail` is capped small; `originalimage` is the real file.
    photo: j?.originalimage?.source,
  };
}

// File names that are almost never a real photo of the subject — Commons
// boilerplate (site logos, edit icons, protection padlocks) and generic
// location/flag graphics that happen to be embedded in most geography articles.
const GALLERY_JUNK_RE = /\b(flag|logo|icon|symbol|shackle|wikivoyage|relief map|location map)\b/i;

/**
 * List a Wikipedia article's embedded images (via the MediaWiki action API,
 * not the REST summary — that only ever gives one lead image) and resolve the
 * first `limit` real-looking ones to actual file URLs at `width` px wide.
 * Two calls: `prop=images` for the File: title list, then a single batched
 * `prop=imageinfo` for their URLs. Keyless. Returns [] on any miss/error —
 * never throws, since this is always a "nice to have" alongside the summary.
 */
export async function fetchWikiGallery(
  title: string,
  limit = 6,
  width = 640,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  try {
    const listUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
      title,
    )}&prop=images&imlimit=50&format=json`;
    const listRes = await fetchImpl(listUrl, { headers: { "User-Agent": WIKI_UA, accept: "application/json" } });
    if (!listRes.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listJ: any = await listRes.json();
    const pages = Object.values(listJ?.query?.pages ?? {}) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileTitles: string[] = (pages[0]?.images ?? [])
      .map((i: any) => i.title as string)
      .filter((t: string) => /\.(jpe?g|png)$/i.test(t) && !GALLERY_JUNK_RE.test(t))
      .slice(0, limit);
    if (!fileTitles.length) return [];

    const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
      fileTitles.join("|"),
    )}&prop=imageinfo&iiprop=url&iiurlwidth=${width}&format=json`;
    const infoRes = await fetchImpl(infoUrl, { headers: { "User-Agent": WIKI_UA, accept: "application/json" } });
    if (!infoRes.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const infoJ: any = await infoRes.json();
    const infoPages = Object.values(infoJ?.query?.pages ?? {}) as any[];
    return infoPages
      .map((p) => p?.imageinfo?.[0]?.thumburl ?? p?.imageinfo?.[0]?.url)
      .filter((u): u is string => typeof u === "string");
  } catch {
    return [];
  }
}
