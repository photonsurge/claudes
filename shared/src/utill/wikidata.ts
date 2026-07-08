import { WIKI_UA } from "./wikipedia";

/**
 * Structured volcano facts pulled from Wikidata, keyed off the Wikipedia
 * article already matched by `fetchWikiSummary`. Verified against a real
 * entity (Mount Etna / Q16990) before writing this: `P2044` = elevation above
 * sea level (metres), `P31` = instance of (resolves to a type label like
 * "stratovolcano"), `P793` = significant event, filtered to ones labeled
 * "volcanic eruption", with a `P585` (point in time) qualifier giving the year.
 *
 * Two round trips: one to resolve the Wikipedia title → Wikidata QID, one to
 * fetch that entity's claims + a batched label lookup for the handful of QIDs
 * referenced by those claims. Keyless. Never throws — degrades to an empty
 * object on any miss so a Wikidata hiccup never blocks the rest of enrichment.
 */
export interface VolcanoFacts {
  elevationM?: number;
  volcanoType?: string;
  lastEruptionYear?: number;
}

const METRE_QID = "Q11573";
const ERUPTION_LABEL_RE = /eruption/i;

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<any> {
  const res = await fetchImpl(url, { headers: { "User-Agent": WIKI_UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Wikipedia article title → its Wikidata QID (`pageprops.wikibase_item`), or undefined on any miss. */
async function fetchWikidataQid(title: string, fetchImpl: typeof fetch): Promise<string | undefined> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    title,
  )}&prop=pageprops&format=json`;
  const j = await fetchJson(url, fetchImpl);
  const pages = Object.values(j?.query?.pages ?? {}) as any[];
  return pages[0]?.pageprops?.wikibase_item;
}

export async function fetchVolcanoFacts(
  wikipediaTitle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VolcanoFacts> {
  try {
    const qid = await fetchWikidataQid(wikipediaTitle, fetchImpl);
    if (!qid) return {};

    const entityJ = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, fetchImpl);
    const claims = entityJ?.entities?.[qid]?.claims ?? {};

    const elevationClaim = claims.P2044?.[0]?.mainsnak?.datavalue?.value;
    const elevationM =
      elevationClaim?.unit?.endsWith(`/${METRE_QID}`) && Number.isFinite(Number(elevationClaim.amount))
        ? Number(elevationClaim.amount)
        : undefined;

    const typeQid: string | undefined = claims.P31?.[0]?.mainsnak?.datavalue?.value?.id;

    const eruptionClaims = (claims.P793 ?? []).filter((c: any) => c?.mainsnak?.datavalue?.value?.id);
    const eventQids: string[] = eruptionClaims.map((c: any) => c.mainsnak.datavalue.value.id);

    const labelQids = [typeQid, ...eventQids].filter(Boolean) as string[];
    const labels: Record<string, string> = labelQids.length
      ? await fetchJson(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${labelQids.join(
            "|",
          )}&props=labels&languages=en&format=json`,
          fetchImpl,
        ).then((j) =>
          Object.fromEntries(
            Object.entries(j?.entities ?? {}).map(([id, e]: [string, any]) => [id, e?.labels?.en?.value]),
          ),
        )
      : {};

    const volcanoType = typeQid ? labels[typeQid] : undefined;

    const eruptionYears = eruptionClaims
      .filter((c: any) => ERUPTION_LABEL_RE.test(labels[c.mainsnak.datavalue.value.id] ?? ""))
      .map((c: any) => {
        const time: string | undefined = c.qualifiers?.P585?.[0]?.datavalue?.value?.time;
        const m = time?.match(/^\+?(\d+)-/);
        return m ? Number(m[1]) : undefined;
      })
      .filter((y: number | undefined): y is number => Number.isFinite(y));
    const lastEruptionYear = eruptionYears.length ? Math.max(...eruptionYears) : undefined;

    return { elevationM, volcanoType, lastEruptionYear };
  } catch {
    return {};
  }
}

/**
 * Structured city facts pulled from Wikidata, same two-round-trip shape as
 * `fetchVolcanoFacts`: `P571` = inception (founding date), `P2046` = area
 * (square kilometres, unit QID Q712226), `P2044` = elevation above sea level
 * (metres). Keyless. Never throws — degrades to an empty object on any miss.
 */
export interface CityFacts {
  foundedYear?: number;
  areaKm2?: number;
  elevationM?: number;
}

const SQ_KM_QID = "Q712226";

export async function fetchCityFacts(
  wikipediaTitle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CityFacts> {
  try {
    const qid = await fetchWikidataQid(wikipediaTitle, fetchImpl);
    if (!qid) return {};

    const entityJ = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, fetchImpl);
    const claims = entityJ?.entities?.[qid]?.claims ?? {};

    const inceptionTime: string | undefined = claims.P571?.[0]?.mainsnak?.datavalue?.value?.time;
    const inceptionMatch = inceptionTime?.match(/^\+?(\d+)-/);
    const foundedYear = inceptionMatch ? Number(inceptionMatch[1]) : undefined;

    const areaClaim = claims.P2046?.[0]?.mainsnak?.datavalue?.value;
    const areaKm2 =
      areaClaim?.unit?.endsWith(`/${SQ_KM_QID}`) && Number.isFinite(Number(areaClaim.amount))
        ? Number(areaClaim.amount)
        : undefined;

    const elevationClaim = claims.P2044?.[0]?.mainsnak?.datavalue?.value;
    const elevationM =
      elevationClaim?.unit?.endsWith(`/${METRE_QID}`) && Number.isFinite(Number(elevationClaim.amount))
        ? Number(elevationClaim.amount)
        : undefined;

    return { foundedYear, areaKm2, elevationM };
  } catch {
    return {};
  }
}
