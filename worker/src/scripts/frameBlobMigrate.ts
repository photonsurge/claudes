/**
 * One-shot migration — `yarn migrate:frame-blobs`. Moves the texture bytes of
 * the WeatherFrame + WeatherForecastFrame archives out of the metadata docs and
 * into their `*Data` sidecar collections (see shared/src/db/blob-store.ts).
 *
 * Why: `.select({ data: 0 })` does NOT stop Mongo reading the inline Buffer —
 * WiredTiger reads the whole document off disk, so every `listMeta` history
 * scan pages the never-pruned texture archive through Mongo's cache. Splitting
 * the bytes into a by-id sidecar means the metadata scan never touches a blob.
 *
 * Ordering is crash-safe: write the sidecar bytes FIRST, then `$unset` the
 * inline copy. A crash mid-run leaves a doc with both (harmless — reads prefer
 * the sidecar) and re-running only touches whatever inline bytes remain, so the
 * script is idempotent. RELIEF ONLY LANDS ONCE THIS HAS RUN — until then old
 * rows still carry inline bytes and `listMeta` stays heavy for them.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Model } from "mongoose";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { BlobStore } from "@photonsurge/shared/db/blob-store";

const LOG_EVERY = 200;

async function migrate(
  label: string,
  model: Model<{ id: string; data?: Buffer }>,
  blobs: BlobStore,
): Promise<number> {
  const total = await model.countDocuments({ data: { $exists: true } });
  console.log(`${label}: ${total} frame(s) with inline bytes to move…`);
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
    if (moved % LOG_EVERY === 0) console.log(`  ${label}: ${moved}/${total}`);
  }
  console.log(`${label}: done — ${moved} frame(s) externalised.`);
  return moved;
}

(async () => {
  const db = await getAppDb();
  const frames = db.weatherFrames;
  const fcast = db.weatherForecastFrames;

  const a = await migrate(
    "WeatherFrame",
    frames.model as unknown as Model<{ id: string; data?: Buffer }>,
    frames.blobs,
  );
  const b = await migrate(
    "WeatherForecastFrame",
    fcast.model as unknown as Model<{ id: string; data?: Buffer }>,
    fcast.blobs,
  );

  console.log(`all done — ${a + b} frame(s) externalised total.`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("frameBlobMigrate fatal:", err);
  process.exit(1);
});
