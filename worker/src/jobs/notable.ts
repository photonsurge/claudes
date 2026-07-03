/**
 * Notable-tracks catalog jobs (worker side of the "Notable Tracks" feature):
 *
 *  • seedNotable  — upsert the curated starter list (shared/tracks/notable-seed)
 *                   WITHOUT clobbering worker-enriched fields, so a reseed is safe.
 *  • enrichNotable — cache a photo + blurb (+ type/operator/flag) onto each enabled
 *                    catalog entry from FREE keyless sources, read Mongo at air time.
 *
 * Enrichment is deliberately LOW-PRIORITY and never duplicates work:
 *   - only `enabled` entries, only when stale (STALE_DAYS) — the catalog is tiny.
 *   - aircraft type/operator is READ from the existing `aircraftMeta` cache (filled
 *     by tracks.enrichAircraft from hexdb), never re-fetched here — no duplicate GETs.
 *   - Wikipedia (by article title) + planespotters (by hex) are notable-only, so
 *     they don't overlap the city/aircraft enrichments either.
 *
 * The `seedNotable` / `runNotableEnrich` cores are exported so the `yarn seed:notable`
 * and `yarn enrich:notable` one-shots run the exact same code as the job handlers.
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { NOTABLE_SEED } from "@photonsurge/shared/tracks/notable-seed";
import { notableId, type iNotableTrackModel } from "@photonsurge/shared/db/notable-track-model";
import { fetchWikiSummary } from "@photonsurge/shared/utill/wikipedia";
import { fetchAircraftPhoto } from "@photonsurge/shared/tracks/planespotters";
import { mmsiCountry } from "@photonsurge/shared/tracks/flags";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { log } from "@photonsurge/shared/utill/logger";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";
import { summarizeForLog } from "../utils";

const TAG = "job:notable";
const STALE_DAYS = 30;
const GAP_MS = 250; // gentle — keyless services + a tiny catalog, so pace calls.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Drop undefined keys so an upsert `$set` never nulls a field it didn't mean to. */
const defined = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

// ── Seed ──────────────────────────────────────────────────────────────────────

/**
 * Upsert the curated catalog. Only ever writes the CURATED fields (label, wiki
 * title, flags, seed type/operator) — never the enriched ones (photo/blurb/
 * *FetchedAt) — so re-running keeps whatever the enrich job has cached.
 */
export async function seedNotable() {
  const db = await getAppDb();
  let upserted = 0;
  for (const s of NOTABLE_SEED) {
    const code = s.code.trim().toLowerCase();
    const id = notableId(s.kind, code);
    await db.notableTracks.upsertByID(
      id,
      defined({
        id,
        kind: s.kind,
        code,
        label: s.label,
        category: s.category,
        wikiTitle: s.wikiTitle,
        enabled: s.enabled ?? true,
        vip: s.vip,
        type: s.type,
        operator: s.operator,
        registration: s.registration,
        imo: s.imo,
        notes: s.notes,
      }) as Partial<iNotableTrackModel>,
    );
    upserted++;
  }
  const result = { seeded: upserted };
  log(TAG, `seedNotable done`, result);
  blogInfo(TAG, `seeded ${upserted} notable tracks`, result, "notable", "seed");
  emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "notable", count: upserted } });
  return result;
}

/** Job handler: `notable.seed`. */
export async function seed(_job: Job) {
  try {
    return await seedNotable();
  } catch (err) {
    log(TAG, `seed failed`, { err: summarizeForLog(err) });
    blogErr(TAG, `notable seed failed`, err, "notable", "seed");
    throw err;
  }
}

// ── Enrichment ────────────────────────────────────────────────────────────────

export interface NotableEnrichOpts {
  /** Re-fetch even entries enriched within STALE_DAYS. */
  force?: boolean;
}

/**
 * Fill photo + blurb (+ type/operator/flag) onto each enabled catalog entry.
 * Incremental (staleness-gated) + gently paced. Returns a small summary.
 */
export async function runNotableEnrich(opts: NotableEnrichOpts = {}) {
  const force = Boolean(opts.force);
  const db = await getAppDb();
  const staleMs = Date.now() - STALE_DAYS * 86_400_000;

  const res = await db.notableTracks.getAll({ enabled: true }, { limit: 0 });
  const all = res.data ?? [];
  if (!all.length) return { candidates: 0, enriched: 0, withPhoto: 0 };

  // Preload the aircraftMeta cache for the aircraft in the catalog — REUSE the
  // hexdb data enrichAircraft already fetched, rather than calling hexdb again.
  const aircraftCodes = [...new Set(all.filter((n) => n.kind === "aircraft").map((n) => n.code))];
  const metaRes = aircraftCodes.length
    ? await db.aircraftMeta.getAll({ id: { $in: aircraftCodes } }, { limit: aircraftCodes.length })
    : { data: [] as { id: string; type?: string; operator?: string; registration?: string }[] };
  const metaByCode = new Map((metaRes.data ?? []).map((m) => [m.id, m]));

  let enriched = 0;
  let withPhoto = 0;
  for (const n of all) {
    const needWiki = force || !n.wikiFetchedAt || n.wikiFetchedAt < staleMs;
    const needPhoto = n.kind === "aircraft" && (force || !n.photoFetchedAt || n.photoFetchedAt < staleMs);
    const patch: Partial<iNotableTrackModel> = {};

    // Wikipedia photo + blurb, from the exact article title.
    if (needWiki && n.wikiTitle) {
      try {
        const r = await fetchWikiSummary(n.wikiTitle);
        if (r !== "missing" && r !== "disambig") {
          if (r.extract) patch.wikiExtract = r.extract;
          if (r.thumb) patch.photoUrl = r.thumb; // fallback photo; planespotters wins below
        }
      } catch (err) {
        log(TAG, `wiki ${n.label} failed`, { err: summarizeForLog(err) });
      }
      patch.wikiFetchedAt = Date.now();
      await sleep(GAP_MS);
    }

    // planespotters airframe photo (aircraft) — preferred over the wiki thumb.
    if (needPhoto) {
      try {
        const p = await fetchAircraftPhoto(n.code);
        if (p) {
          patch.photoUrl = p.photoUrl;
          patch.photoCredit = p.photoCredit;
          patch.photoLink = p.photoLink;
        }
      } catch (err) {
        log(TAG, `photo ${n.label} failed`, { err: summarizeForLog(err) });
      }
      patch.photoFetchedAt = Date.now();
      await sleep(GAP_MS);
    }

    // Type/operator/registration from the aircraftMeta cache (no network), only
    // to fill gaps the seed didn't provide.
    if (n.kind === "aircraft") {
      const m = metaByCode.get(n.code);
      if (m) {
        if (!n.type && m.type) patch.type = m.type;
        if (!n.operator && m.operator) patch.operator = m.operator;
        if (!n.registration && m.registration) patch.registration = m.registration;
      }
    }

    // Flag/country from the MMSI MID (ships) — local, no network.
    if (n.kind === "ship" && !n.flag) {
      const c = mmsiCountry(n.code);
      if (c) {
        patch.flag = c.flag;
        patch.country = c.name;
      }
    }

    if (Object.keys(patch).length) {
      await db.notableTracks.updateByID(n.id, patch);
      enriched++;
      if (patch.photoUrl || n.photoUrl) withPhoto++;
    }
  }

  const result = { candidates: all.length, enriched, withPhoto };
  log(TAG, `runNotableEnrich done`, result);
  blogInfo(TAG, `notable enrich: ${enriched} updated (${withPhoto} with a photo)`, result, "notable", "enrich");
  if (enriched > 0) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "notable", enriched } });
  return result;
}

/** Job handler: `notable.enrichNotable` — options from the job's preset data. */
export async function enrichNotable(job: Job) {
  const d = job.data?.data ?? {};
  try {
    return await runNotableEnrich({ force: Boolean(d.force) });
  } catch (err) {
    log(TAG, `enrichNotable failed`, { err: summarizeForLog(err) });
    blogErr(TAG, `notable enrichment failed`, err, "notable", "enrich");
    throw err;
  }
}
