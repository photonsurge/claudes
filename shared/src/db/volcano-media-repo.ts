import { createHash } from "node:crypto";
import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { VolcanoMedia } from "../volcanoes/media";
import type { iVolcanoMediaModel } from "./volcano-media-model";
import type { InlineBlobStore } from "./inline-blob";

export type VolcanoMediaInput = Omit<VolcanoMedia, "id" | "acquiredAt" | "contentHash" | "assetRef"> & {
  bytes?: Buffer;
  acquiredAt?: Date;
  contentHash?: string;
};

const meta = (d: any): VolcanoMedia => { const { _id, __v, data, ...rest } = d; return rest; };

export function makeVolcanoMediaRepo(model: Model<iVolcanoMediaModel>, blobs: InlineBlobStore) {
  return {
    model,
    async put(input: VolcanoMediaInput): Promise<{ id: string; inserted: boolean }> {
      const contentHash = input.contentHash ?? (input.bytes ? createHash("sha256").update(input.bytes).digest("hex") : undefined);
      const query = input.sourceMediaId
        ? { source: input.source, sourceMediaId: input.sourceMediaId }
        : input.cameraId && contentHash ? { cameraId: input.cameraId, contentHash } : null;
      const existing = query ? await model.findOne(query, { id: 1 }).lean<{ id: string }>().exec() : null;
      if (existing) return { id: existing.id, inserted: false };
      const id = uuidv4();
      if (input.bytes) await blobs.put(id, input.bytes);
      const { bytes, ...fields } = input;
      await model.create({ ...fields, id, acquiredAt: input.acquiredAt ?? new Date(), contentHash, assetRef: input.bytes ? id : undefined,
        data: input.bytes ? blobs.inlineValue(input.bytes) : undefined });
      return { id, inserted: true };
    },
    async listForVolcano(volcanoId: string): Promise<VolcanoMedia[]> {
      const docs = await model.find({ volcanoId }).select("-data").sort({ observedAt: -1, acquiredAt: -1 }).lean().exec();
      return docs.map(meta);
    },
    async getAsset(id: string): Promise<{ data: Buffer; contentType: string } | null> {
      const doc = await model.findOne({ id }).exec();
      if (!doc) return null;
      const data = await blobs.get(id, doc.data);
      return data ? { data, contentType: doc.contentType ?? "application/octet-stream" } : null;
    },
    async rightsSummary(): Promise<{ licence: string; reuseAllowed: boolean | null; count: number }[]> {
      const rows = await model.aggregate([
        { $group: { _id: { licence: { $ifNull: ["$licence", "VERIFY"] }, reuseAllowed: { $ifNull: ["$reuseAllowed", null] } }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).exec();
      return rows.map((row: any) => ({ licence: row._id.licence, reuseAllowed: row._id.reuseAllowed, count: row.count }));
    },
  };
}
