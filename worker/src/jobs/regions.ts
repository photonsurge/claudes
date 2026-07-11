import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { cityGeoWithinBox } from "@photonsurge/shared/db/city-model";
import { REGION_PRESETS } from "@photonsurge/shared/regions";
import { memberCountryCodes, isBboxScoped, isLandGroup } from "@photonsurge/shared/region-membership";
import type { iRegionCountry, iRegionCity } from "@photonsurge/shared/db/region-model";
import { fetchWikiSummary, fetchWikiGallery } from "@photonsurge/shared/utill/wikipedia";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:regions";

/** Seed/refresh the Region catalog from the curated `REGION_PRESETS` (shared/src/regions.ts). */
export async function runRegionSeed(): Promise<{ regions: number; upserted: number; removed: number }> {
  const db = await getAppDb();
  const docs = REGION_PRESETS.map((r) => ({ regionId: r.id, name: r.label, group: r.group, bbox: r.bbox }));
  const res = await db.regions.upsertMany(docs);
  // Prune regions dropped from REGION_PRESETS so a reseed reflects deletions,
  // not just additions/edits — otherwise removed presets linger in the catalog.
  const pruned = await db.regions.pruneExcept(docs.map((d) => d.regionId));
  const result = { regions: docs.length, upserted: res.upserted, removed: pruned.removed };
  log(TAG, "seed done", result);
  blogInfo(
    TAG,
    `regions seed: ${docs.length} regions (${res.upserted} new, ${pruned.removed} removed)`,
    result,
    "regions",
    "seed",
  );
  emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "regions", count: docs.length } });
  return result;
}

/** Job handler: `regions.seed`. */
export async function seed(_job: Job) {
  try {
    return await runRegionSeed();
  } catch (err) {
    log(TAG, "seed failed", summarizeForLog(err));
    blogErr(TAG, "regions seed failed", err, "regions", "seed");
    throw err;
  }
}

// ── Wikipedia enrichment ──────────────────────────────────────────────────
// Oceans/continents/blocs have no Wikidata "country facts" worth pulling
// (population/capital/currency don't apply) — just the photo/blurb.

const STALE_DAYS = 30;
const GAP_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RegionWikiEnrichOpts {
  force?: boolean;
}

export async function runRegionWikiEnrich(opts: RegionWikiEnrichOpts = {}) {
  const force = Boolean(opts.force);
  const db = await getAppDb();
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);
  const regions = await db.regions.listNeedingEnrichment(staleBefore, force);
  log(TAG, `enrichWiki ${regions.length} regions`, { force });

  let enriched = 0;
  let withPhoto = 0;
  let noMatch = 0;
  for (const r of regions) {
    try {
      const summary = await fetchWikiSummary(r.name);
      if (summary === "missing" || summary === "disambig") {
        noMatch++;
        await db.regions.updateEnrichment(r.regionId, { wikiFetchedAt: new Date() });
      } else {
        await sleep(GAP_MS);
        const gallery = await fetchWikiGallery(summary.title);
        await db.regions.updateEnrichment(r.regionId, {
          wikiTitle: summary.title,
          wikiThumb: summary.thumb,
          wikiPhoto: summary.photo,
          wikiExtract: summary.extract,
          wikiGallery: gallery.length ? gallery : undefined,
          wikiFetchedAt: new Date(),
        });
        enriched++;
        if (summary.thumb || summary.photo) withPhoto++;
      }
    } catch (err) {
      log(TAG, `enrichWiki ${r.name} failed`, summarizeForLog(err));
    }
    await sleep(GAP_MS);
  }

  const result = { candidates: regions.length, enriched, withPhoto, noMatch };
  log(TAG, "enrichWiki done", result);
  blogInfo(
    TAG,
    `region wiki enrich: ${enriched} enriched (${withPhoto} with a photo), ${noMatch} no match`,
    result,
    "regions",
    "enrich",
  );
  if (enriched > 0) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "regions", count: enriched } });
  return result;
}

/** Job handler: `regions.enrichWiki`. */
export async function enrichWiki(job: Job) {
  const d = job.data?.data ?? {};
  try {
    return await runRegionWikiEnrich({ force: d.force });
  } catch (err) {
    log(TAG, "enrichWiki failed", summarizeForLog(err));
    blogErr(TAG, "region wiki enrichment failed", err, "regions", "enrich");
    throw err;
  }
}

// ── Places dossier: member countries + biggest cities ──────────────────────
// Membership is the CURATED relation (region-membership.ts), never bbox alone —
// so a country lands in the right region and can belong to several at once. Only
// bbox-scoped sub-national bands (US West, Amazonia, …) additionally bbox-filter
// their cities. Land regions only; oceans skipped.

/** Store all in-region cities at/above this population; a min-N fallback keeps
 *  sparse regions (Amazonia, Siberia) populated even when few clear the floor. */
const CITY_POP_FLOOR = 100_000;
const MIN_CITIES = 10;
/** Doc-size guardrail for dense continents — logged, never silent. */
const MAX_STORED_CITIES = 200;

/**
 * Recompute the places dossier for every land region: the member countries (from
 * the curated relation, enriched with a city-presence proxy) and the biggest
 * cities within it. Reads the Country catalog for continent membership + names
 * and the City collection for the cities — so run `countries.seed`/`cities.seed`
 * first.
 */
export async function runRegionPlaces(): Promise<{ regions: number; withCountries: number; withCities: number }> {
  const db = await getAppDb();
  const [regions, countries] = await Promise.all([db.regions.list(), db.countries.list()]);
  const nameByCc = new Map<string, string>();
  for (const c of countries) if (c.iso2) nameByCc.set(c.iso2.toLowerCase(), c.name);

  let processed = 0;
  let withCountries = 0;
  let withCities = 0;

  for (const r of regions) {
    if (!isLandGroup(r.group)) continue;
    processed++;

    const codes = memberCountryCodes(r.regionId, countries);
    if (!codes.length) {
      await db.regions.updatePlaces(r.regionId, { countries: [], topCities: [], placesFetchedAt: new Date() });
      continue;
    }

    // Cities: country ∈ members (match either catalog casing), + bbox if the
    // region is a sub-national band. Population-ranked.
    const ccVariants = [...codes, ...codes.map((c) => c.toUpperCase())];
    const query: Record<string, unknown> = { cc: { $in: ccVariants } };
    if (isBboxScoped(r.regionId)) {
      const [w, s, e, n] = r.bbox;
      query.loc = cityGeoWithinBox(w, s, e, n);
    }
    const cityDocs = await db.cities.model
      .find(query, { id: 1, name: 1, country: 1, cc: 1, lat: 1, lng: 1, population: 1, _id: 0 })
      .sort({ population: -1 })
      .lean()
      .exec();

    const ranked: iRegionCity[] = cityDocs.map((c: any) => ({
      cityId: c.id,
      name: c.name,
      country: c.country,
      cc: c.cc,
      lat: c.lat,
      lng: c.lng,
      population: c.population ?? 0,
    }));

    const major = ranked.filter((c) => (c.population ?? 0) >= CITY_POP_FLOOR);
    let topCities = major.length >= MIN_CITIES ? major : ranked.slice(0, MIN_CITIES);
    if (topCities.length > MAX_STORED_CITIES) {
      log(TAG, `region ${r.regionId}: ${topCities.length} cities capped to ${MAX_STORED_CITIES}`);
      topCities = topCities.slice(0, MAX_STORED_CITIES);
    }

    // Member countries: the curated set, each enriched by its in-region cities.
    const byCc = new Map<string, iRegionCity[]>();
    for (const c of ranked) {
      const cc = (c.cc ?? "").toLowerCase();
      if (!cc) continue;
      let arr = byCc.get(cc);
      if (!arr) {
        arr = [];
        byCc.set(cc, arr);
      }
      arr.push(c);
    }
    const countryList: iRegionCountry[] = codes
      .map((cc) => {
        const grp = byCc.get(cc) ?? [];
        const pop = grp.reduce((s, c) => s + (c.population ?? 0), 0);
        return {
          cc,
          name: nameByCc.get(cc) ?? cc.toUpperCase(),
          cityCount: grp.length,
          topCity: grp[0]?.name,
          population: pop || undefined,
        };
      })
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0) || a.name.localeCompare(b.name));

    await db.regions.updatePlaces(r.regionId, { countries: countryList, topCities, placesFetchedAt: new Date() });
    if (countryList.length) withCountries++;
    if (topCities.length) withCities++;
  }

  const result = { regions: processed, withCountries, withCities };
  log(TAG, "enrichPlaces done", result);
  blogInfo(
    TAG,
    `region places: ${processed} land regions (${withCountries} w/ countries, ${withCities} w/ cities)`,
    result,
    "regions",
    "places",
  );
  emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "regions", count: processed } });
  return result;
}

/** Job handler: `regions.enrichPlaces`. */
export async function enrichPlaces(_job: Job) {
  try {
    return await runRegionPlaces();
  } catch (err) {
    log(TAG, "enrichPlaces failed", summarizeForLog(err));
    blogErr(TAG, "region places enrichment failed", err, "regions", "places");
    throw err;
  }
}
