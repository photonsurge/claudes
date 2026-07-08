import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { REGION_PRESETS } from "@photonsurge/shared/regions";
import { fetchWikiSummary, fetchWikiGallery } from "@photonsurge/shared/utill/wikipedia";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:regions";

/** Seed/refresh the Region catalog from the curated `REGION_PRESETS` (shared/src/regions.ts). */
export async function runRegionSeed(): Promise<{ regions: number; upserted: number }> {
  const db = await getAppDb();
  const docs = REGION_PRESETS.map((r) => ({ regionId: r.id, name: r.label, group: r.group, bbox: r.bbox }));
  const res = await db.regions.upsertMany(docs);
  const result = { regions: docs.length, upserted: res.upserted };
  log(TAG, "seed done", result);
  blogInfo(TAG, `regions seed: ${docs.length} regions (${res.upserted} new)`, result, "regions", "seed");
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
