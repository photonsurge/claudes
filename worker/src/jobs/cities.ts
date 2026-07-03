/**
 * City-overlay dataset jobs (worker side of the admin "Cities" buttons):
 *
 *  • seed       — replace the cities collection from a GeoNames tier (the IO glue
 *                 around the pure parsers in @photonsurge/shared/cities/geonames).
 *  • enrichWiki — cache a Wikipedia photo + blurb onto prominent city docs so the
 *                 "near this event" broadcast panel reads Mongo, never Wikipedia.
 *
 * The `seedCities` / `runWikiEnrich` cores are exported so the `yarn seed:cities`
 * and `yarn enrich:wiki` one-shot scripts run the exact same code as the buttons.
 */
import type { Job } from "bullmq";
import { unzipSync } from "fflate";
import { getAppDb } from "@photonsurge/shared/db/index";
import {
  parseCountryInfo,
  parseGeonamesCities,
  isGeonamesTier,
  DEFAULT_CITIES_TIER,
} from "@photonsurge/shared/cities/geonames";
import { CITIES_UPDATED } from "@photonsurge/shared/control";
import { fetchWikiSummary } from "@photonsurge/shared/utill/wikipedia";
import { log } from "@photonsurge/shared/utill/logger";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";
import { summarizeForLog } from "../utils";
import { sendToQueue, QUEUE_PRIORITY } from "@photonsurge/shared/bull/bull-queue";

const TAG = "job:cities";
const DUMP = "https://download.geonames.org/export/dump";
const INSERT_BATCH = 5000;

// ── Seed ────────────────────────────────────────────────────────────────────

/** Replace the cities collection from a GeoNames tier. Fetches + unzips here;
 *  the row → doc mapping is the pure shared parser. Emits CITIES_UPDATED so the
 *  live globe refetches. */
export async function seedCities(tier: string = DEFAULT_CITIES_TIER) {
  log(TAG, `seedCities fetching GeoNames ${tier}…`);
  const [zipRes, countryRes] = await Promise.all([
    fetch(`${DUMP}/${tier}.zip`),
    fetch(`${DUMP}/countryInfo.txt`),
  ]);
  if (!zipRes.ok) throw new Error(`GeoNames ${tier}.zip fetch failed ${zipRes.status}`);
  if (!countryRes.ok) throw new Error(`GeoNames countryInfo fetch failed ${countryRes.status}`);

  const countryNames = parseCountryInfo(await countryRes.text());
  const zip = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
  const entry = zip[`${tier}.txt`];
  if (!entry) throw new Error(`no ${tier}.txt inside the GeoNames archive`);
  const docs = parseGeonamesCities(new TextDecoder().decode(entry), countryNames);

  const db = await getAppDb();
  await db.cities.deleteMany({});
  let inserted = 0;
  for (let i = 0; i < docs.length; i += INSERT_BATCH) {
    const r = await db.cities.model.insertMany(docs.slice(i, i + INSERT_BATCH), { ordered: false });
    inserted += r.length;
  }

  const result = { tier, parsed: docs.length, inserted };
  log(TAG, `seedCities done`, result);
  blogInfo(TAG, `reseeded ${inserted} cities from GeoNames ${tier}`, result, "cities", "seed");
  emitWorkerEvent({ type: CITIES_UPDATED, data: { count: inserted } });
  return result;
}

/** Job handler: `cities.seed` — tier from the button's preset data. */
export async function seed(job: Job) {
  const raw = job.data?.data?.tier;
  const tier = isGeonamesTier(raw) ? raw : DEFAULT_CITIES_TIER;
  try {
    return await seedCities(tier);
  } catch (err) {
    log(TAG, `seed failed`, { tier, err: summarizeForLog(err) });
    blogErr(TAG, `city reseed (${tier}) failed`, err, "cities", "seed");
    throw err;
  }
}

// ── Wikipedia enrichment ──────────────────────────────────────────────────────

const STALE_DAYS = 30;
const GAP_MS = 150; // ~6-7 req/s — well within Wikipedia's limits, still kind.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WikiEnrichOpts {
  /** Enrich cities with population ≥ this (plus every capital). Default 100k. */
  minPopulation?: number;
  /** Cap how many to process this run (0 = no cap). */
  limit?: number;
  /** Re-fetch even cities enriched within STALE_DAYS. */
  force?: boolean;
}

/** Build the candidate query. A zero population threshold explicitly means all
 * cities, including older/manual records with no population field at all. */
export function wikiEnrichQuery(minPopulation: number, staleBefore: Date, force: boolean) {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const query: any = minPopulation <= 0
    ? {}
    : { $or: [{ population: { $gte: minPopulation } }, { isCapital: true }] };
  if (!force) query.wikiFetchedAt = { $not: { $gt: staleBefore } };
  return query;
}

/** Cache Wikipedia title/thumb/extract onto prominent city docs. Incremental
 *  (skips fresh ones unless force); never closes the connection (caller owns it). */
export async function runWikiEnrich(opts: WikiEnrichOpts = {}) {
  const minPopulation = Number.isFinite(opts.minPopulation) ? (opts.minPopulation as number) : 100_000;
  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0 ? (opts.limit as number) : 0;
  const force = Boolean(opts.force);

  const db = await getAppDb();
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);
  const query = wikiEnrichQuery(minPopulation, staleBefore, force);

  let q = db.cities.model.find(query).sort({ population: -1 });
  if (limit > 0) q = q.limit(limit);
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const cities: any[] = await q.lean().exec();
  log(TAG, `enrichWiki ${cities.length} cities`, { minPopulation, limit, force });

  let enriched = 0;
  let withPhoto = 0;
  let noMatch = 0;
  for (const c of cities) {
    try {
      let r = await fetchWikiSummary(c.name);
      // Disambiguation / missing → retry with the "Name, Country" title form.
      if ((r === "missing" || r === "disambig") && c.country) {
        await sleep(GAP_MS);
        r = await fetchWikiSummary(`${c.name}, ${c.country}`);
      }
      if (r === "missing" || r === "disambig") {
        noMatch++;
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
      log(TAG, `enrichWiki ${c.name} failed`, { err: summarizeForLog(err) });
    }
    await sleep(GAP_MS);
  }

  const result = { candidates: cities.length, enriched, withPhoto, noMatch };
  log(TAG, `enrichWiki done`, result);
  blogInfo(TAG, `wiki enrich: ${enriched} enriched (${withPhoto} with a photo), ${noMatch} no match`, result, "cities", "enrich");
  if (enriched > 0) emitWorkerEvent({ type: CITIES_UPDATED, data: { enriched } });
  return result;
}

/** Job handler: `cities.enrichWiki` — options from the button's preset data. */
export async function enrichWiki(job: Job) {
  const d = job.data?.data ?? {};
  try {
    return await runWikiEnrich({ minPopulation: d.minPopulation, limit: d.limit, force: d.force });
  } catch (err) {
    log(TAG, `enrichWiki failed`, { err: summarizeForLog(err) });
    blogErr(TAG, `city wiki enrichment failed`, err, "cities", "enrich");
    throw err;
  }
}

/**
 * Long-running all-city enrichment, split into a chain of bounded jobs. Each
 * batch updates fetchedAt, so the next batch naturally selects the next stale
 * rows without fragile offsets. A completely failed batch stops the chain to
 * avoid an infinite retry storm during an upstream outage.
 */
export async function enrichWikiAll(job: Job) {
  const d = job.data?.data ?? {};
  const batchSize = Math.min(Math.max(Number(d.batchSize) || 100, 10), 500);
  const batch = Math.max(Number(d.batch) || 1, 1);
  const maxBatches = Math.min(Math.max(Number(d.maxBatches) || 2_000, 1), 5_000);
  try {
    const result = await runWikiEnrich({ minPopulation: 0, limit: batchSize, force: false });
    const processed = result.enriched + result.noMatch;
    const shouldContinue = result.candidates === batchSize && processed > 0 && batch < maxBatches;
    if (shouldContinue) {
      await sendToQueue(
        "cities",
        "cities",
        "enrichWikiAll",
        { batchSize, batch: batch + 1, maxBatches },
        undefined,
        QUEUE_PRIORITY.LOW,
      );
    }
    return {
      ...result,
      batch,
      batchSize,
      continued: shouldContinue,
      stalled: result.candidates > 0 && processed === 0,
    };
  } catch (err) {
    log(TAG, `enrichWikiAll batch ${batch} failed`, { err: summarizeForLog(err) });
    blogErr(TAG, `all-city enrichment batch ${batch} failed`, err, "cities", "enrich-all");
    throw err;
  }
}
