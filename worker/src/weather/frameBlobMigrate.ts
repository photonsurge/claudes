/**
 * Core of the frame-blob migration, shared by the `migrate:frame-blobs` one-shot
 * script and the `maintenance.migrateFrameBlobs` admin-Jobs button. Moves the
 * texture bytes of the WeatherFrame + WeatherForecastFrame archives out of the
 * metadata docs and into their `*Data` sidecar collections (blob-store.ts), so a
 * `listMeta` history scan stops paging the never-pruned texture archive through
 * Mongo's cache.
 *
 * Crash-safe + idempotent: write the sidecar bytes FIRST, then `$unset` the
 * inline copy. A crash mid-run leaves a doc with both (reads prefer the sidecar)
 * and a re-run only touches whatever inline bytes remain.
 */
import type { Model } from "mongoose";
import type { AppDb } from "@photonsurge/shared/db/index";
import type { BlobStore } from "@photonsurge/shared/db/blob-store";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "frameBlobMigrate";
const LOG_EVERY = 200;

/** Model view exposing just the fields the migration reads/writes. */
type InlineFrameModel = Model<{ id: string; data?: Buffer }>;

async function migrateOne(label: string, model: InlineFrameModel, blobs: BlobStore): Promise<number> {
  const total = await model.countDocuments({ data: { $exists: true } });
  log(TAG, `${label}: ${total} frame(s) with inline bytes to move`);
  if (!total) return 0;

  // Cursor with a small batch so we hold only a few texture Buffers at a time.
  const cursor = model
    .find({ data: { $exists: true } })
    .select({ id: 1, data: 1, _id: 0 })
    .lean<{ id: string; data?: Buffer }>()
    .cursor({ batchSize: 25 });

  let moved = 0;
  for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
    if (!doc.data) continue;
    await blobs.put(doc.id, doc.data); // sidecar first…
    await model.updateOne({ id: doc.id }, { $unset: { data: "" } }); // …then drop inline
    moved++;
    if (moved % LOG_EVERY === 0) log(TAG, `  ${label}: ${moved}/${total}`);
  }
  log(TAG, `${label}: done — ${moved} frame(s) externalised`);
  return moved;
}

export interface FrameBlobMigrateResult {
  frame: number;
  forecast: number;
  total: number;
}

/** Externalise inline texture bytes for both frame archives. */
export async function migrateFrameBlobs(db: AppDb): Promise<FrameBlobMigrateResult> {
  const frame = await migrateOne(
    "WeatherFrame",
    db.weatherFrames.model as unknown as InlineFrameModel,
    db.weatherFrames.blobs,
  );
  const forecast = await migrateOne(
    "WeatherForecastFrame",
    db.weatherForecastFrames.model as unknown as InlineFrameModel,
    db.weatherForecastFrames.blobs,
  );
  return { frame, forecast, total: frame + forecast };
}
