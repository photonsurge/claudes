/**
 * Notable-vehicle jobs — the curated subset of the persistent vehicle registry
 * (db.vehicles) that we surface on air:
 *
 *  • seedNotable  — mark the curated starter list (shared/tracks/notable-seed) as
 *                   notable vehicles WITHOUT clobbering enriched/lifecycle fields.
 *  • enrichNotable — cache a photo + blurb (+ type/operator/flag) onto each enabled
 *                    notable vehicle from FREE keyless sources, read Mongo at air time.
 *
 * Enrichment is deliberately LOW-PRIORITY and never duplicates work:
 *   - only notable + enabled vehicles, only when stale (STALE_DAYS) — a tiny set.
 *   - aircraft type/operator is READ from the existing `aircraftMeta` cache (filled
 *     by tracks.enrichAircraft from hexdb), never re-fetched here — no duplicate GETs.
 *   - Wikipedia (by article title) + planespotters (by hex) are notable-only.
 *
 * The `seedNotable` / `runNotableEnrich` cores are exported so the `yarn seed:notable`
 * and `yarn enrich:notable` one-shots run the exact same code as the job handlers.
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { NOTABLE_SEED } from "@photonsurge/shared/tracks/notable-seed";
import { vehicleId, type iVehicle } from "@photonsurge/shared/db/vehicle-model";
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

// ── Seed ──────────────────────────────────────────────────────────────────────

/**
 * Flag the curated starter list as notable vehicles. `upsertCurated` writes only
 * the curated fields (label/wikiTitle/notable/vip/seed type…) and never the
 * enriched or lifecycle ones, so re-running keeps enrichment + sighting history.
 */
export async function seedNotable() {
  const db = await getAppDb();
  let upserted = 0;
  for (const s of NOTABLE_SEED) {
    await db.vehicles.upsertCurated({
      kind: s.kind,
      code: s.code.trim().toLowerCase(),
      label: s.label,
      category: s.category,
      wikiTitle: s.wikiTitle,
      notable: true,
      enabled: s.enabled ?? true,
      vip: s.vip,
      type: s.type,
      operator: s.operator,
      registration: s.registration,
      imo: s.imo,
      notes: s.notes,
    });
    upserted++;
  }
  const result = { seeded: upserted };
  log(TAG, `seedNotable done`, result);
  blogInfo(TAG, `seeded ${upserted} notable vehicles`, result, "notable", "seed");
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
  /** Enrich only these vehicle ids (an explicit target is always fetched now).
   *  Used by the admin "★ Enrich" button so a just-added craft fills in seconds. */
  ids?: string[];
}

/**
 * Fill photo + blurb (+ type/operator/flag) onto each enabled notable vehicle.
 * Incremental (staleness-gated) + gently paced. Returns a small summary.
 */
export async function runNotableEnrich(opts: NotableEnrichOpts = {}) {
  const targeted = Array.isArray(opts.ids) && opts.ids.length > 0;
  const force = Boolean(opts.force) || targeted; // an explicit target is fetched now
  const db = await getAppDb();
  const staleMs = Date.now() - STALE_DAYS * 86_400_000;

  const catalog = await db.vehicles.notableCatalog();
  const targetIds = targeted ? new Set(opts.ids) : null;
  const all = targetIds ? catalog.filter((v) => targetIds.has(v.id)) : catalog;
  if (!all.length) return { candidates: 0, enriched: 0, withPhoto: 0 };

  // Preload the aircraftMeta cache for the aircraft in the catalog — REUSE the
  // hexdb data enrichAircraft already fetched, rather than calling hexdb again.
  const aircraftCodes = [...new Set(all.filter((n) => n.kind === "aircraft").map((n) => n.code))];
  const metaRes = aircraftCodes.length
    ? await db.aircraftMeta.getAll({ id: { $in: aircraftCodes } }, { limit: aircraftCodes.length, sort: null })
    : { data: [] as { id: string; type?: string; operator?: string; registration?: string }[] };
  const metaByCode = new Map((metaRes.data ?? []).map((m) => [m.id, m]));

  let enriched = 0;
  let withPhoto = 0;
  for (const n of all) {
    const needWiki = force || !n.wikiFetchedAt || n.wikiFetchedAt < staleMs;
    const needPhoto = n.kind === "aircraft" && (force || !n.photoFetchedAt || n.photoFetchedAt < staleMs);
    const patch: Partial<iVehicle> = {};

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
    // to fill gaps the seed/sighting didn't provide.
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
      await db.vehicles.patch(n.id, patch);
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
    return await runNotableEnrich({
      force: Boolean(d.force),
      ids: Array.isArray(d.ids) ? d.ids.filter((x: unknown) => typeof x === "string") : undefined,
    });
  } catch (err) {
    log(TAG, `enrichNotable failed`, { err: summarizeForLog(err) });
    blogErr(TAG, `notable enrichment failed`, err, "notable", "enrich");
    throw err;
  }
}
