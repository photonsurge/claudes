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
  parseGeonameZoneRow,
  isGeonamesTier,
  DEFAULT_CITIES_TIER,
} from "@photonsurge/shared/cities/geonames";
import { CITIES_UPDATED } from "@photonsurge/shared/control";
import { fetchWikiSummary, fetchWikiGallery, fetchWikiIntro } from "@photonsurge/shared/utill/wikipedia";
import { fetchCityFacts } from "@photonsurge/shared/utill/wikidata";
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
        const [gallery, intro, facts] = await Promise.all([
          fetchWikiGallery(r.title, 8),
          fetchWikiIntro(r.title),
          fetchCityFacts(r.title),
        ]);
        await db.cities.updateByID(c.id, {
          wikiTitle: r.title,
          wikiThumb: r.thumb,
          wikiPhoto: r.photo,
          wikiExtract: intro || r.extract,
          wikiGallery: gallery.length ? gallery : undefined,
          wikiFetchedAt: new Date(),
          foundedYear: facts.foundedYear,
          areaKm2: facts.areaKm2,
          elevationM: facts.elevationM,
        });
        enriched++;
        if (r.thumb || r.photo) withPhoto++;
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
  const minPopulation = Number.isFinite(d.minPopulation) ? Number(d.minPopulation) : 100_000;
  try {
    const result = await runWikiEnrich({ minPopulation, limit: batchSize, force: false });
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

// ── 2dsphere backfill ─────────────────────────────────────────────────────────

const BACKFILL_BATCH = 2000;

/**
 * Job handler: `cities.backfillLoc` — fill the 2dsphere `loc` Point onto city
 * docs seeded before the field existed, so `$geoWithin` box lookups use the geo
 * index instead of walking the population index end-to-end. Reseeds set `loc`
 * directly (the parser), so this is a one-time catch-up after deploying the
 * field; it's idempotent — only docs missing `loc` are touched, so it's safe to
 * re-run and cheap once complete.
 */
export async function backfillLoc(_job?: Job) {
  const db = await getAppDb();
  const cursor = db.cities.model
    .find({ loc: { $exists: false } }, { id: 1, lat: 1, lng: 1, _id: 0 })
    .lean()
    .cursor({ batchSize: BACKFILL_BATCH });

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  let ops: any[] = [];
  let updated = 0;
  let skipped = 0;
  const flush = async () => {
    if (!ops.length) return;
    await db.cities.model.bulkWrite(ops, { ordered: false });
    updated += ops.length;
    ops = [];
    log(TAG, `backfillLoc ${updated} filled…`);
  };

  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    for (let doc = (await cursor.next()) as any; doc; doc = (await cursor.next()) as any) {
      const lng = Number(doc.lng);
      const lat = Number(doc.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        skipped++;
        continue;
      }
      ops.push({
        updateOne: {
          filter: { id: doc.id },
          update: { $set: { loc: { type: "Point", coordinates: [lng, lat] } } },
        },
      });
      if (ops.length >= BACKFILL_BATCH) await flush();
    }
    await flush();
  } finally {
    await cursor.close();
  }

  const remaining = await db.cities.model.countDocuments({ loc: { $exists: false } });
  const result = { updated, skipped, remaining };
  log(TAG, `backfillLoc done`, result);
  blogInfo(TAG, `city geo-index backfill: ${updated} filled, ${remaining} still without loc`, result, "cities", "backfill-loc");
  return result;
}

// ── Timezone backfill ─────────────────────────────────────────────────────────

/** The dump the backfill reads by default. cities500 is a SUPERSET of every
 *  seed tier, so one run fills the collection whichever tier it was seeded
 *  from — at the cost of the biggest download. */
const TZ_BACKFILL_TIER: string = "cities500";

/** Rows scanned between event-loop yields. The dump is ~200k lines and the
 *  worker runs the socket/queue loop in this same process, so the scan hands
 *  the loop back rather than blocking it for the whole parse. */
const TZ_SCAN_CHUNK = 5000;

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

/**
 * PURE-ish: geonames id → IANA zone for every row of a decoded dump, scanned in
 * chunks so a 200k-row file never blocks the worker loop end-to-end. Only two
 * short strings per row are retained — never a city doc.
 */
async function zonesFromDump(text: string): Promise<Map<string, string>> {
  const zones = new Map<string, string>();
  let from = 0;
  let scanned = 0;
  while (from <= text.length) {
    const nl = text.indexOf("\n", from);
    const line = text.slice(from, nl === -1 ? text.length : nl);
    const row = parseGeonameZoneRow(line);
    if (row) zones.set(row.id, row.timezone);
    if (nl === -1) break;
    from = nl + 1;
    if (++scanned % TZ_SCAN_CHUNK === 0) await yieldToLoop();
  }
  return zones;
}

/**
 * Job handler: `cities.backfillTimezones` — fill the IANA `timezone` onto city
 * docs seeded before the field existed, so the on-air "local time here" row can
 * read a real zone (DST, +5:30, +5:45) instead of the round(lng/15) guess.
 *
 * Re-reads a GeoNames dump and matches on the geonames id already baked into
 * every seeded doc (`gn-<id>`), so it is a pure field fill: nothing else on the
 * doc is touched and Wikipedia enrichment survives (unlike a reseed, which
 * replaces the collection). Idempotent — only docs missing a timezone are
 * written, so re-running once complete costs one download and no writes.
 *
 * Defaults to the finest tier because it is a superset of every seed tier; pass
 * `tier` to use a smaller download when the collection's own tier is known.
 */
export async function backfillTimezones(job?: Job) {
  const raw = job?.data?.data?.tier;
  const tier = isGeonamesTier(raw) ? raw : TZ_BACKFILL_TIER;
  const force = Boolean(job?.data?.data?.force);

  log(TAG, `backfillTimezones fetching GeoNames ${tier}…`);
  const zipRes = await fetch(`${DUMP}/${tier}.zip`);
  if (!zipRes.ok) throw new Error(`GeoNames ${tier}.zip fetch failed ${zipRes.status}`);
  const zip = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
  const entry = zip[`${tier}.txt`];
  if (!entry) throw new Error(`no ${tier}.txt inside the GeoNames archive`);

  const zones = await zonesFromDump(new TextDecoder().decode(entry));
  log(TAG, `backfillTimezones parsed ${zones.size} zones from ${tier}`);

  const db = await getAppDb();
  const query = force ? {} : { timezone: { $exists: false } };
  const cursor = db.cities.model
    .find(query, { id: 1, _id: 0 })
    .lean()
    .cursor({ batchSize: BACKFILL_BATCH });

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  let ops: any[] = [];
  let updated = 0;
  let unmatched = 0;
  const flush = async () => {
    if (!ops.length) return;
    await db.cities.model.bulkWrite(ops, { ordered: false });
    updated += ops.length;
    ops = [];
    log(TAG, `backfillTimezones ${updated} filled…`);
  };

  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    for (let doc = (await cursor.next()) as any; doc; doc = (await cursor.next()) as any) {
      const tz = zones.get(String(doc.id));
      if (!tz) {
        unmatched++; // a hand-added city, or one this tier does not carry
        continue;
      }
      ops.push({ updateOne: { filter: { id: doc.id }, update: { $set: { timezone: tz } } } });
      if (ops.length >= BACKFILL_BATCH) await flush();
    }
    await flush();
  } finally {
    await cursor.close();
  }

  const remaining = await db.cities.model.countDocuments({ timezone: { $exists: false } });
  const result = { tier, parsed: zones.size, updated, unmatched, remaining };
  log(TAG, `backfillTimezones done`, result);
  blogInfo(
    TAG,
    `city timezone backfill: ${updated} filled from ${tier}, ${remaining} still without a zone`,
    result,
    "cities",
    "backfill-timezones",
  );
  return result;
}
