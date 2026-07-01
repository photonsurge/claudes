/**
 * Manual one-shot Wikipedia enrichment — `yarn enrich:wiki [minPopulation] [limit]`.
 *
 * For prominent cities (population ≥ minPopulation, default 100k, plus every
 * capital) fetches the Wikipedia REST summary and caches the title, thumbnail
 * URL and short extract onto the City doc. The public broadcast overlay then
 * shows a photo + blurb for cities near an on-air event by reading Mongo — it
 * never calls Wikipedia at request time (same "worker caches, public reads"
 * rule as tracks/cams/cables).
 *
 * Repeatable + incremental: skips cities enriched within STALE_DAYS unless
 * `--force`. Polite: a descriptive User-Agent (Wikipedia requires one) and a
 * fixed gap between requests.
 *
 *   cd worker && yarn enrich:wiki            # all ≥100k + capitals, stale-only
 *   cd worker && yarn enrich:wiki 500000 200 # ≥500k, at most 200 this run
 *   cd worker && yarn enrich:wiki 0 --force  # re-fetch everything already known
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Wikipedia's API policy requires a descriptive User-Agent with contact info.
const WIKI_UA =
  "LiveWeatherGlobe/0.1 (broadcast city enrichment; https://github.com/; contact ravergeek@gmail.com)";
const STALE_DAYS = 30;
const GAP_MS = 150; // ~6-7 req/s — well within Wikipedia's limits, still kind.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Summary = { title: string; extract?: string; thumb?: string };

/** Fetch a Wikipedia REST summary for an exact title, or a miss reason. */
async function fetchSummary(title: string): Promise<Summary | "missing" | "disambig"> {
  const slug = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}?redirect=true`;
  const res = await fetch(url, {
    headers: { "User-Agent": WIKI_UA, accept: "application/json" },
  });
  if (res.status === 404) return "missing";
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j: any = await res.json();
  if (typeof j?.type === "string" && j.type.includes("disambiguation")) return "disambig";
  return {
    title: j?.title ?? title,
    extract: typeof j?.extract === "string" && j.extract.trim() ? j.extract.trim() : undefined,
    thumb: j?.thumbnail?.source,
  };
}

(async () => {
  const minPop = Number(process.argv[2]);
  const minPopulation = Number.isFinite(minPop) ? minPop : 100_000;
  const limitArg = Number(process.argv[3]);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : 0;
  const force = process.argv.includes("--force");

  const db = await getAppDb();
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);
  const query: any = { $or: [{ population: { $gte: minPopulation } }, { isCapital: true }] };
  if (!force) {
    query.wikiFetchedAt = { $not: { $gt: staleBefore } };
  }

  let q = db.cities.model.find(query).sort({ population: -1 });
  if (limit > 0) q = q.limit(limit);
  const cities: any[] = await q.lean().exec();
  console.log(
    `[enrich:wiki] ${cities.length} cities to enrich (minPop=${minPopulation}, limit=${limit || "none"}, force=${force})`,
  );

  let enriched = 0;
  let withPhoto = 0;
  let noMatch = 0;
  for (let i = 0; i < cities.length; i++) {
    const c = cities[i];
    try {
      let r = await fetchSummary(c.name);
      // Disambiguation / missing → retry with the "Name, Country" title form
      // Wikipedia commonly uses (e.g. "Springfield, Illinois").
      if ((r === "missing" || r === "disambig") && c.country) {
        await sleep(GAP_MS);
        r = await fetchSummary(`${c.name}, ${c.country}`);
      }
      if (r === "missing" || r === "disambig") {
        noMatch++;
        // Stamp the attempt so a stale-only re-run doesn't keep retrying it.
        await db.cities.updateByID(c.id, { wikiFetchedAt: new Date() });
      } else {
        await db.cities.updateByID(c.id, {
          wikiTitle: r.title,
          wikiThumb: r.thumb,
          wikiExtract: r.extract,
          wikiFetchedAt: new Date(),
        });
        enriched++;
        if (r.thumb) withPhoto++;
      }
    } catch (err) {
      console.error(`[enrich:wiki] ${c.name}:`, (err as Error).message);
    }
    await sleep(GAP_MS);
    if ((i + 1) % 50 === 0) console.log(`  …${i + 1}/${cities.length}`);
  }

  console.log(
    `[enrich:wiki] done: ${enriched} enriched (${withPhoto} with a photo), ${noMatch} no match`,
  );
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("enrichWikipedia fatal:", err);
  process.exit(1);
});
