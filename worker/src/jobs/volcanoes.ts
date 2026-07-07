import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchVolcanoes } from "@photonsurge/shared/volcanoes/gvp";
import { fetchWikiSummary } from "@photonsurge/shared/utill/wikipedia";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:volcanoes";

/**
 * Dispatched as type "volcanoes", event "snapshot". Pulls the Smithsonian/USGS
 * Weekly Volcanic Activity Report (whole globe, no key) and upserts them into
 * Mongo on the volcano's stable VOTW number; a TTL on `fetchedAt` drops
 * volcanoes that stop showing up in the bulletin. The public route reads only
 * this cache.
 */
export async function snapshot(_job: Job) {
  const db = await getAppDb();
  try {
    const { volcanoes } = await fetchVolcanoes();
    const r = await db.volcanoes.upsertMany(volcanoes);
    const result = { volcanoes: volcanoes.length, upserted: r.upserted };
    log(TAG, `volcanoes snapshot done`, result);
    blogInfo(TAG, `volcanoes snapshot: ${volcanoes.length} active`, result, "volcanoes", "snapshot");
    // Live push so the overlay refetches the instant a snapshot lands.
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: volcanoes.length } });
    return result;
  } catch (err) {
    log(TAG, `volcanoes snapshot failed`, summarizeForLog(err));
    blogErr(TAG, `volcanoes snapshot failed`, err, "volcanoes", "snapshot");
    throw err;
  }
}

// ── Wikipedia enrichment ──────────────────────────────────────────────────────

const STALE_DAYS = 30;
const GAP_MS = 150; // ~6-7 req/s — well within Wikipedia's limits, still kind.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The report's own volcano name is usually already close to the Wikipedia
 * article title (e.g. "Nevados de Chillan"), but sometimes needs a nudge — try
 * the bare name, then without a trailing "Volcano"/"Volcanic Complex" suffix
 * some entries carry — first non-missing/disambiguation hit wins.
 */
export function titleCandidates(name: string): string[] {
  const out = [name];
  const noPlace = name.replace(/,\s*[^,]+$/, "").trim();
  if (noPlace && !out.includes(noPlace)) out.push(noPlace);
  const bare = noPlace.replace(/\s+Volcan(o|ic)(\s+(Group|Field|Complex))?$/i, "").trim();
  if (bare && !out.includes(bare)) out.push(bare);
  return out;
}

export interface VolcanoWikiEnrichOpts {
  /** Re-fetch even volcanoes enriched within STALE_DAYS. */
  force?: boolean;
}

/** Cache Wikipedia title/thumb/extract onto active volcano docs. Incremental
 *  (skips fresh ones unless force); never closes the connection (caller owns it). */
export async function runVolcanoWikiEnrich(opts: VolcanoWikiEnrichOpts = {}) {
  const force = Boolean(opts.force);
  const db = await getAppDb();
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);
  const volcanoes = await db.volcanoes.listNeedingEnrichment(staleBefore, force);
  log(TAG, `enrichWiki ${volcanoes.length} volcanoes`, { force });

  let enriched = 0;
  let withPhoto = 0;
  let noMatch = 0;
  for (const v of volcanoes) {
    try {
      let r: Awaited<ReturnType<typeof fetchWikiSummary>> = "missing";
      for (const title of titleCandidates(v.name)) {
        r = await fetchWikiSummary(title);
        if (r !== "missing" && r !== "disambig") break;
        await sleep(GAP_MS);
      }
      if (r === "missing" || r === "disambig") {
        noMatch++;
        await db.volcanoes.updateEnrichment(v.volcanoId, { wikiFetchedAt: new Date() });
      } else {
        await db.volcanoes.updateEnrichment(v.volcanoId, {
          wikiTitle: r.title,
          wikiThumb: r.thumb,
          wikiExtract: r.extract,
          wikiFetchedAt: new Date(),
        });
        enriched++;
        if (r.thumb) withPhoto++;
      }
    } catch (err) {
      log(TAG, `enrichWiki ${v.name} failed`, summarizeForLog(err));
    }
    await sleep(GAP_MS);
  }

  const result = { candidates: volcanoes.length, enriched, withPhoto, noMatch };
  log(TAG, `enrichWiki done`, result);
  blogInfo(
    TAG,
    `volcano wiki enrich: ${enriched} enriched (${withPhoto} with a photo), ${noMatch} no match`,
    result,
    "volcanoes",
    "enrich",
  );
  // Live push so the overlay/admin table refetch the instant enrichment lands.
  if (enriched > 0) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: enriched } });
  return result;
}

/** Job handler: `volcanoes.enrichWiki`. */
export async function enrichWiki(job: Job) {
  const d = job.data?.data ?? {};
  try {
    return await runVolcanoWikiEnrich({ force: d.force });
  } catch (err) {
    log(TAG, `enrichWiki failed`, summarizeForLog(err));
    blogErr(TAG, `volcano wiki enrichment failed`, err, "volcanoes", "enrich");
    throw err;
  }
}
