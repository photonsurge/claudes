import type { Model } from "mongoose";
import type { BlobUsage } from "./blob-fs";
import { BLOB_USAGE_ID, type iBlobUsageModel } from "./blob-usage-model";

export interface BlobUsageSnapshot {
  usage: BlobUsage;
  measuredAt: string;
  tookMs: number;
}

/**
 * Read/write the cached blob-folder measurement. One document, replaced whole by
 * the worker's `maintenance.measureBlobs` job; read by /api/admin/files, which
 * must never do the walk itself (see blob-usage-model.ts).
 */
export function makeBlobUsageRepo(model: Model<iBlobUsageModel>) {
  return {
    model,

    /** The last measurement, or null if the worker has never run one. */
    async get(): Promise<BlobUsageSnapshot | null> {
      const doc = await model.findOne({ id: BLOB_USAGE_ID }).lean<iBlobUsageModel>().exec();
      if (!doc?.usage) return null;
      return {
        usage: doc.usage,
        measuredAt: new Date(doc.measuredAt).toISOString(),
        tookMs: doc.tookMs ?? 0,
      };
    },

    /** Replace the measurement. Called only by the worker. */
    async save(usage: BlobUsage, tookMs: number): Promise<void> {
      await model
        .updateOne(
          { id: BLOB_USAGE_ID },
          { $set: { usage, tookMs, measuredAt: new Date() }, $setOnInsert: { id: BLOB_USAGE_ID } },
          { upsert: true },
        )
        .exec();
    },
  };
}

export type BlobUsageRepo = ReturnType<typeof makeBlobUsageRepo>;
