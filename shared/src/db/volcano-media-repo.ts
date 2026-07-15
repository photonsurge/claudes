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
    /**
     * Store a camera's CURRENT frame — one row per (camera, type), overwritten in
     * place. This is the only write path for camera imagery: we broadcast "what
     * does it look like right now", so a frame archive earns nothing and costs
     * everything (~300 cameras polled all day, every changed frame a new row +
     * blob, nothing ever deleted). {@link put} still appends for the one-off,
     * genuinely distinct media a source publishes (eruption photos, reports).
     *
     * Overwriting under the EXISTING id keeps two useful invariants:
     *  - `/api/volcanoes/media/:id` is a stable, permanent URL per camera, so a
     *    cached focus bundle can't point at a row we've just replaced;
     *  - `blobs.put` on the same key replaces the bytes, so no orphan is left on
     *    disk (which a delete-then-insert would do on every single poll).
     */
    async putLatest(input: VolcanoMediaInput & { cameraId: string }): Promise<{ id: string; changed: boolean }> {
      const contentHash = input.contentHash ?? (input.bytes ? createHash("sha256").update(input.bytes).digest("hex") : undefined);
      const existing = await model.findOne({ cameraId: input.cameraId, type: input.type }, { id: 1, contentHash: 1 })
        .lean<{ id: string; contentHash?: string }>().exec();
      const acquiredAt = input.acquiredAt ?? new Date();
      const { bytes, ...fields } = input;

      if (!existing) {
        const id = uuidv4();
        if (bytes) await blobs.put(id, bytes);
        await model.create({ ...fields, id, acquiredAt, contentHash, assetRef: bytes ? id : undefined,
          data: bytes ? blobs.inlineValue(bytes) : undefined });
        return { id, changed: true };
      }
      // Identical frame (camera idle, or the provider serving a cached image):
      // record that we looked, but don't rewrite bytes we already hold.
      if (contentHash && existing.contentHash === contentHash) {
        await model.updateOne({ id: existing.id }, { $set: { acquiredAt } }).exec();
        return { id: existing.id, changed: false };
      }
      if (bytes) await blobs.put(existing.id, bytes);
      await model.updateOne({ id: existing.id }, { $set: { ...fields, acquiredAt, contentHash,
        assetRef: bytes ? existing.id : undefined, data: bytes ? blobs.inlineValue(bytes) : undefined } }).exec();
      return { id: existing.id, changed: true };
    },
    /**
     * Collapse an existing camera-frame archive down to the newest frame per
     * camera, deleting the superseded rows AND their blobs. Idempotent, so it's
     * safe to leave wired to a schedule as a backstop as well as running once to
     * clear the backlog {@link put} accumulated before latest-only existed.
     */
    async pruneToLatestPerCamera(opts: { dryRun?: boolean } = {}): Promise<{ removed: number; kept: number }> {
      // Grouped by (cameraId, type) — exactly {@link putLatest}'s key, so a camera
      // publishing both a visible and a thermal feed keeps one frame of each.
      const groups = await model.aggregate([
        { $match: { cameraId: { $ne: null } } },
        { $sort: { observedAt: -1, acquiredAt: -1 } },
        { $group: { _id: { cameraId: "$cameraId", type: "$type" }, keep: { $first: "$id" }, ids: { $push: "$id" } } },
      ]).exec();
      const stale = groups.flatMap((g: any) => (g.ids as string[]).filter((id) => id !== g.keep));
      if (opts.dryRun || !stale.length) return { removed: stale.length, kept: groups.length };
      await blobs.delete(stale);
      await model.deleteMany({ id: { $in: stale } }).exec();
      return { removed: stale.length, kept: groups.length };
    },
    /**
     * Do we already hold this source's media? `put` dedups on the same key, but
     * only AFTER the caller has downloaded the bytes — and `sourceMediaId` is
     * known before the fetch. Checking here turns a re-download of every image on
     * every pass into a single indexed lookup (`volcano_media_source_ix`).
     */
    async hasSourceMedia(source: VolcanoMedia["source"], sourceMediaId: string): Promise<boolean> {
      return !!(await model.exists({ source, sourceMediaId }));
    },
    async listForVolcano(volcanoId: string): Promise<VolcanoMedia[]> {
      const docs = await model.find({ volcanoId }).select("-data").sort({ observedAt: -1, acquiredAt: -1 }).lean().exec();
      return docs.map(meta);
    },
    async listLatestForVolcano(volcanoId: string, limit = 24): Promise<VolcanoMedia[]> {
      const docs = await model.find({ volcanoId }).select("-data").sort({ observedAt: -1, acquiredAt: -1 }).limit(limit).lean().exec();
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
