/**
 * Core of the blob→filesystem migration, shared by the `migrate:blobs` one-shot
 * script and the `maintenance.migrateBlobs` admin-Jobs button. Moves every stored
 * binary payload out of Mongo (inline on the doc, or in a `*Data` sidecar) onto
 * the shared `${BLOB_DIR}` folder, so the database server stops replicating,
 * backing up and paging the binary archive. See shared/db/blob-fs.ts.
 *
 * Precious-state safe: for each blob it writes the file, READS IT BACK and checks
 * the length, and only then drops the Mongo copy. A crash (or a failed verify)
 * leaves the Mongo copy intact — reads are FS-first with a Mongo fallback, so a
 * half-migrated collection serves correctly throughout. Idempotent: a re-run only
 * touches whatever bytes still remain in Mongo.
 *
 * No-op (with a clear log) when `BLOB_DIR` is unset — there is nowhere to move to.
 */
import type { Model } from "mongoose";
import type { AppDb } from "@photonsurge/shared/db/index";
import type { BlobFs } from "@photonsurge/shared/db/blob-fs";
import { toBuffer } from "@photonsurge/shared/db/inline-blob";
import { log, logWarn } from "@photonsurge/shared/utill/logger";

const TAG = "blobMigrate";
const LOG_EVERY = 500;

export interface BlobMigrateCounts {
  moved: number;
  skipped: number;
}

export interface BlobMigrateResult {
  moved: number;
  skipped: number;
  byCollection: Record<string, BlobMigrateCounts>;
}

/** A collection that keeps its bytes INLINE on the doc (`field`), keyed by `keyField`. */
interface InlineSpec {
  label: string;
  model: Model<any>;
  ns: string;
  field: string; // "data" | "png"
  keyField: string; // "id" | "adId" | "satId"
}

/** A `*Data` sidecar collection of `{ refId, data }` rows. */
interface SidecarSpec {
  label: string;
  model: Model<any>;
  ns: string;
}

/** Confirm the bytes landed on disk intact before we drop the Mongo copy. */
async function verified(fs: BlobFs, ns: string, key: string, expectLen: number): Promise<boolean> {
  const back = await fs.get(ns, key);
  return !!back && back.byteLength === expectLen;
}

async function migrateInline(fs: BlobFs, spec: InlineSpec): Promise<BlobMigrateCounts> {
  const { label, model, ns, field, keyField } = spec;
  const filter = { [field]: { $exists: true, $ne: null } };
  const total = await model.countDocuments(filter);
  log(TAG, `${label}: ${total} doc(s) with inline bytes to move`);
  let moved = 0;
  let skipped = 0;
  if (!total) return { moved, skipped };

  // Small batch so only a few blobs are held in memory at once.
  const cursor = model
    .find(filter)
    .select({ [keyField]: 1, [field]: 1, _id: 0 })
    .lean()
    .cursor({ batchSize: 25 });

  for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
    const key = doc[keyField] != null ? String(doc[keyField]) : "";
    const bytes = toBuffer(doc[field]);
    if (!key || !bytes.length) {
      skipped++;
      continue;
    }
    await fs.put(ns, key, bytes); // disk first…
    if (!(await verified(fs, ns, key, bytes.byteLength))) {
      logWarn(TAG, `${label}: verify FAILED for ${key} — Mongo copy left in place`);
      skipped++;
      continue;
    }
    await model.updateOne({ [keyField]: doc[keyField] }, { $unset: { [field]: "" } }); // …then drop inline
    moved++;
    if (moved % LOG_EVERY === 0) log(TAG, `  ${label}: ${moved}/${total}`);
  }
  log(TAG, `${label}: done — ${moved} moved, ${skipped} skipped`);
  return { moved, skipped };
}

async function migrateSidecar(fs: BlobFs, spec: SidecarSpec): Promise<BlobMigrateCounts> {
  const { label, model, ns } = spec;
  const filter = { data: { $exists: true } };
  const total = await model.countDocuments(filter);
  log(TAG, `${label}: ${total} sidecar blob(s) to move`);
  let moved = 0;
  let skipped = 0;
  if (!total) return { moved, skipped };

  const cursor = model
    .find(filter)
    .select({ refId: 1, data: 1, _id: 0 })
    .lean()
    .cursor({ batchSize: 25 });

  for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
    const key = doc.refId != null ? String(doc.refId) : "";
    const bytes = toBuffer(doc.data);
    if (!key || !bytes.length) {
      skipped++;
      continue;
    }
    await fs.put(ns, key, bytes);
    if (!(await verified(fs, ns, key, bytes.byteLength))) {
      logWarn(TAG, `${label}: verify FAILED for ${key} — Mongo copy left in place`);
      skipped++;
      continue;
    }
    await model.deleteOne({ refId: doc.refId }); // remove the whole sidecar row
    moved++;
    if (moved % LOG_EVERY === 0) log(TAG, `  ${label}: ${moved}/${total}`);
  }
  log(TAG, `${label}: done — ${moved} moved, ${skipped} skipped`);
  return { moved, skipped };
}

/** Externalise every Mongo-stored blob onto the shared `${BLOB_DIR}` folder. */
export async function migrateBlobs(db: AppDb): Promise<BlobMigrateResult> {
  const byCollection: Record<string, BlobMigrateCounts> = {};
  const fs = db.blobFs;
  if (!fs) {
    log(TAG, "BLOB_DIR not set — nothing to migrate (still storing blobs in Mongo)");
    return { moved: 0, skipped: 0, byCollection };
  }

  const inlineSpecs: InlineSpec[] = [
    { label: "WeatherTexture", model: db.weatherTextures.model, ns: db.blobs.tex.ns, field: "data", keyField: "id" },
    { label: "WeatherFrame(inline)", model: db.weatherFrames.model, ns: db.weatherFrames.blobs.ns, field: "data", keyField: "id" },
    { label: "WeatherForecastFrame(inline)", model: db.weatherForecastFrames.model, ns: db.weatherForecastFrames.blobs.ns, field: "data", keyField: "id" },
    { label: "AdminImage", model: db.adminImages.model, ns: db.blobs.adminImage.ns, field: "data", keyField: "id" },
    { label: "Ad", model: db.ads.model, ns: db.blobs.ad.ns, field: "data", keyField: "adId" },
    { label: "Aurora", model: db.aurora.auroraModel, ns: db.blobs.aurora.ns, field: "png", keyField: "id" },
    { label: "Geomag", model: db.geomag.geomagModel, ns: db.blobs.geomag.ns, field: "png", keyField: "id" },
    { label: "SatImg", model: db.satimg.satImgModel, ns: db.blobs.satimg.ns, field: "png", keyField: "satId" },
  ];
  const sidecarSpecs: SidecarSpec[] = [
    { label: "WeatherFrameData", model: db.weatherFrames.blobs.model, ns: db.weatherFrames.blobs.ns },
    { label: "WeatherForecastFrameData", model: db.weatherForecastFrames.blobs.model, ns: db.weatherForecastFrames.blobs.ns },
  ];

  let moved = 0;
  let skipped = 0;
  for (const spec of inlineSpecs) {
    const c = await migrateInline(fs, spec);
    byCollection[spec.label] = c;
    moved += c.moved;
    skipped += c.skipped;
  }
  for (const spec of sidecarSpecs) {
    const c = await migrateSidecar(fs, spec);
    byCollection[spec.label] = c;
    moved += c.moved;
    skipped += c.skipped;
  }

  log(TAG, `all collections done — ${moved} blob(s) externalised, ${skipped} skipped`);
  return { moved, skipped, byCollection };
}
