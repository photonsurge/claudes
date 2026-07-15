import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import {
  fetchGvpHoloceneVolcanoes,
  fetchGvpPleistoceneVolcanoes,
  fetchGvpEruptions,
} from "@photonsurge/shared/volcanoes/gvp-wfs";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:volcanoCatalog";

/**
 * P7 — the COMPLETE volcano catalog (docs/volcano-observation-plan.md).
 *
 * Lives in its own job file (type `volcanoCatalog`) rather than jobs/volcanoes.ts:
 * these are catalog-seeding concerns, not weekly-bulletin ingest, and keeping them
 * apart avoids entangling the two.
 *
 * The core idea: `Volcano` is a PERMANENT catalog entity. Seeding every volcano
 * only works once the 14-day TTL is gone — otherwise all ~2,600 rows silently
 * expire. Run `migrate` once before `seed` on any existing database.
 */

/** Pleistocene volcanoes are numerous and almost entirely inert — opt-in. */
const includePleistocene = () => process.env.VOLCANO_INCLUDE_PLEISTOCENE === "true";

/** Registry-driven volcano camera providers — discovery decides what exists. */
const VOLCANO_CAM_PROVIDERS = [
  "geonet",
  "usgs_vhp",
  "avo",
  "ingv",
  "phivolcs",
  "imo",
  "magma",
  "jma",
  "cenapred",
  "ipgp_ovpf",
];

/**
 * Dispatched as `volcanoCatalog.purgeOrphanCams`. Deletes volcano cameras that the
 * registries no longer discover (status "offline").
 *
 * Why this exists: `offlineMissing` only MARKS undiscovered cams offline, and
 * nothing ever deleted them. The INGV adapter originally minted a sha1 id per
 * ARCHIVED FRAME (`.../webcams/Emct/20260713/0500/Emct0118.jpg`), so a single sweep
 * created hundreds of "cameras" named after a relative archive path. The adapter was
 * fixed to dedup per station, but every orphan it had already written stayed in the
 * catalog forever, offline and useless.
 *
 * MANUAL ONLY — deliberately not scheduled. A transient registry outage marks a
 * provider's whole catalog offline, and an automatic purge would then delete live
 * cameras. Run `data.dryRun: true` to see what would go without deleting.
 */
export async function purgeOrphanCams(job: Job) {
  const db = await getAppDb();
  const dryRun = job?.data?.data?.dryRun === true;
  try {
    const r = await db.cams.purgeOffline(VOLCANO_CAM_PROVIDERS, { dryRun });
    const result = { dryRun, matched: r.matched, removed: r.removed, sample: r.sample };
    log(TAG, `orphan cam purge ${dryRun ? "(dry run) " : ""}done`, result);
    blogInfo(
      TAG,
      dryRun
        ? `orphan volcano cameras: ${r.matched} would be removed (dry run)`
        : `orphan volcano cameras: ${r.removed} removed`,
      result,
      "volcanoes",
      "purgeOrphanCams",
    );
    if (r.removed) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: r.removed } });
    return result;
  } catch (err) {
    log(TAG, `orphan cam purge failed`, summarizeForLog(err));
    blogErr(TAG, `orphan volcano camera purge failed`, err, "volcanoes", "purgeOrphanCams");
    throw err;
  }
}

/**
 * Dispatched as `volcanoCatalog.migrate`. ONE-SHOT database migration for the
 * "Volcano is a permanent catalog entity" change:
 *
 *  1. Drops `volcano_ttl_ix`. Removing the index declaration from the schema does
 *     NOT drop an index that already exists — Mongo keeps expiring documents until
 *     the index is explicitly dropped. Without this, seeding the catalog quietly
 *     deletes it 14 days later.
 *  2. Backfills `bulletinAt` from `fetchedAt`. Every row present today got there
 *     via the weekly bulletin, so `fetchedAt` is a faithful "last listed" value —
 *     and after this, "in the current bulletin" reads `bulletinAt`, never row
 *     existence.
 *
 * Idempotent: a second run finds no TTL and nothing left to backfill.
 */
export async function migrate(_job: Job) {
  const db = await getAppDb();
  try {
    const coll = db.volcanoes.model.collection;
    let ttlDropped = false;
    try {
      const indexes = await coll.indexes();
      const ttl = indexes.find((i: any) => i.name === "volcano_ttl_ix" || i.expireAfterSeconds !== undefined);
      if (ttl?.name) {
        await coll.dropIndex(ttl.name);
        ttlDropped = true;
        log(TAG, `dropped TTL index`, { name: ttl.name });
      }
    } catch (err) {
      // An index that isn't there is success, not failure.
      log(TAG, `TTL drop skipped`, summarizeForLog(err));
    }

    const res = await db.volcanoes.model
      .updateMany({ bulletinAt: { $exists: false }, fetchedAt: { $exists: true } }, [
        { $set: { bulletinAt: "$fetchedAt" } },
      ])
      .exec();

    const result = { ttlDropped, bulletinBackfilled: res.modifiedCount ?? 0 };
    log(TAG, `catalog migration done`, result);
    blogInfo(
      TAG,
      `volcano catalog migration: TTL ${ttlDropped ? "dropped" : "already absent"}, ${result.bulletinBackfilled} bulletinAt backfilled`,
      result,
      "volcanoes",
      "migrate",
    );
    return result;
  } catch (err) {
    log(TAG, `catalog migration failed`, summarizeForLog(err));
    blogErr(TAG, `volcano catalog migration failed`, err, "volcanoes", "migrate");
    throw err;
  }
}

/**
 * Dispatched as `volcanoCatalog.seed`. Upserts EVERY volcano from the Smithsonian
 * GVP VOTW WFS (~1,196 Holocene; +~1,451 Pleistocene when opted in) with the full
 * catalog dossier — type, landform, tectonic setting, epoch, rock types, region,
 * GVP's geology prose and its primary photo.
 *
 * Idempotent and non-destructive: `upsertCatalogMany` writes only catalog fields,
 * so a reseed never resets a volcano's live status or wipes its enrichment.
 * `data.pleistocene: true` forces the Pleistocene set for a one-off run.
 */
export async function seed(job: Job) {
  const db = await getAppDb();
  const wantPleistocene = job?.data?.data?.pleistocene === true || includePleistocene();
  try {
    const holocene = await fetchGvpHoloceneVolcanoes();
    const pleistocene = wantPleistocene ? await fetchGvpPleistoceneVolcanoes() : [];
    const all = [...holocene, ...pleistocene];
    if (!all.length) throw new Error("GVP catalog returned no volcanoes");

    const r = await db.volcanoes.upsertCatalogMany(all);
    const result = {
      holocene: holocene.length,
      pleistocene: pleistocene.length,
      total: all.length,
      inserted: r.upserted,
      updated: r.matched,
    };
    log(TAG, `catalog seed done`, result);
    blogInfo(
      TAG,
      `volcano catalog: ${all.length} volcanoes (${r.upserted} new, ${r.matched} refreshed)`,
      result,
      "volcanoes",
      "seed",
    );
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: all.length } });
    return result;
  } catch (err) {
    log(TAG, `catalog seed failed`, summarizeForLog(err));
    blogErr(TAG, `volcano catalog seed failed`, err, "volcanoes", "seed");
    throw err;
  }
}

/**
 * Dispatched as `volcanoCatalog.seedEruptions`. Upserts the full GVP eruption
 * history (~11,089 rows) on the stable `eruptionNumber` — permanent catalog facts
 * that power "last erupted 1707" and the eruption band of the per-volcano timeline.
 * Dates stay fuzzy (year/month/day + precision): GVP years reach 55,500 BCE and use
 * 0 as an "unknown" month/day sentinel, so they are never forced into a JS Date.
 */
export async function seedEruptions(_job: Job) {
  const db = await getAppDb();
  try {
    const eruptions = await fetchGvpEruptions();
    if (!eruptions.length) throw new Error("GVP eruptions returned no rows");
    const r = await db.volcanoEruptions.upsertMany(eruptions);
    const withVei = eruptions.filter((e) => e.vei !== undefined).length;
    const result = {
      eruptions: eruptions.length,
      inserted: r.upserted,
      updated: r.matched,
      withVei,
      confirmed: eruptions.filter((e) => e.confirmed).length,
    };
    log(TAG, `eruption history seed done`, result);
    blogInfo(
      TAG,
      `volcano eruption history: ${eruptions.length} eruptions (${r.upserted} new)`,
      result,
      "volcanoes",
      "seedEruptions",
    );
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: eruptions.length } });
    return result;
  } catch (err) {
    log(TAG, `eruption history seed failed`, summarizeForLog(err));
    blogErr(TAG, `volcano eruption seed failed`, err, "volcanoes", "seedEruptions");
    throw err;
  }
}

/**
 * Collapse the camera-frame archive down to the latest frame per camera.
 *
 * `cameraRefresh` used to append a row + blob for every novel frame, with a
 * dedup window that never expired — so ~300 cameras polled every 5 minutes grew
 * `volcano_media` (and its blob folder) forever. It now overwrites a single
 * latest frame per camera, but the backlog it already wrote needs clearing once.
 *
 * Idempotent, and wired to a daily schedule as a backstop for any writer that
 * appends camera frames in future.
 *
 * Run `pruneMediaDryRun` first: it reports what WOULD go without deleting.
 */
async function pruneLatest(dryRun: boolean) {
  const db = await getAppDb();
  try {
    const res = await db.volcanoMedia.pruneToLatestPerCamera({ dryRun });
    const result = { ...res, dryRun };
    log(TAG, `volcano media prune${dryRun ? " (dry run)" : ""} done`, result);
    blogInfo(
      TAG,
      `volcano media prune${dryRun ? " (dry run)" : ""}: ${res.removed} superseded frames, ${res.kept} cameras kept`,
      result,
      "volcanoes",
      "pruneMedia",
    );
    return result;
  } catch (err) {
    log(TAG, `volcano media prune failed`, summarizeForLog(err));
    blogErr(TAG, `volcano media prune failed`, err, "volcanoes", "pruneMedia");
    throw err;
  }
}

export const pruneMediaDryRun = (_job: Job) => pruneLatest(true);
export const pruneMedia = (_job: Job) => pruneLatest(false);
