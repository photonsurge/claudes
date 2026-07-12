import type { Model } from "mongoose";
import type { SatImgBounds, SatImgMeta } from "../satimg/types";
import type { iSatImgModel } from "./satimg-model";
import type { InlineBlobStore } from "./inline-blob";

/** Everything the worker hands the repo for one baked frame. */
export interface SatImgBakeInput {
  satId: string;
  satName: string;
  subLon: number;
  composite: string;
  observationTime: Date;
  bounds: SatImgBounds;
  width: number;
  height: number;
  png: Buffer;
  contentType?: string;
}

const toMeta = (doc: any): SatImgMeta => ({
  satId: doc.satId,
  satName: doc.satName,
  subLon: doc.subLon,
  composite: doc.composite,
  observationTime: new Date(doc.observationTime).toISOString(),
  bounds: doc.bounds as SatImgBounds,
  width: doc.width,
  height: doc.height,
  updatedAt: new Date(doc.fetchedAt).toISOString(),
});

/**
 * Satellite-frame persistence + overlay reads. The worker `replace`s the ONE cached
 * frame for a bird on each bake (upsert on that bird's `satId`). Reads split so the
 * metadata endpoint never ships the PNG bytes: `all()`/`latest()` project the blob
 * out; `latestPng()` fetches only the blob for the image route. Multiple birds
 * coexist — `all()` returns every satellite's frame so the overlay can drape them
 * together.
 */
export function makeSatImgRepo(satImgModel: Model<iSatImgModel>, blobs: InlineBlobStore) {
  return {
    satImgModel,

    /** Replace this bird's single cached frame with a freshly baked one. */
    async replace(frame: SatImgBakeInput): Promise<{ satId: string }> {
      await blobs.put(frame.satId, frame.png); // bytes to disk first when FS-backed
      await satImgModel.updateOne(
        { satId: frame.satId },
        {
          $set: {
            satName: frame.satName,
            subLon: frame.subLon,
            composite: frame.composite,
            observationTime: frame.observationTime,
            bounds: frame.bounds,
            width: frame.width,
            height: frame.height,
            png: blobs.inlineValue(frame.png),
            contentType: frame.contentType ?? "image/png",
            fetchedAt: new Date(),
          },
          $setOnInsert: { id: frame.satId, satId: frame.satId },
        },
        { upsert: true },
      );
      return { satId: frame.satId };
    },

    /** Every bird's frame metadata (no pixel bytes), newest-observation first. */
    async all(): Promise<{ frames: SatImgMeta[] }> {
      const docs = await satImgModel
        .find({})
        .select("-png")
        .sort({ observationTime: -1 })
        .lean()
        .exec();
      return { frames: docs.map(toMeta) };
    },

    /** One bird's frame metadata, or null if that bird is unbaked. */
    async latest(satId: string): Promise<{ frame: SatImgMeta | null }> {
      const doc = await satImgModel.findOne({ satId }).select("-png").lean().exec();
      return { frame: doc ? toMeta(doc) : null };
    },

    /** One bird's baked PNG bytes for the image route, or null if unbaked. */
    async latestPng(
      satId: string,
    ): Promise<{ data: Buffer; contentType: string; updatedAt: string } | null> {
      // No `.lean()` so Mongoose casts an inline `png` to a real Buffer; the blob
      // store reads disk-first and only falls back to that inline value.
      const doc = await satImgModel.findOne({ satId }).exec();
      if (!doc) return null;
      const data = await blobs.get(satId, doc.png);
      if (!data || !data.length) return null;
      return {
        data,
        contentType: doc.contentType ?? "image/png",
        updatedAt: new Date(doc.fetchedAt).toISOString(),
      };
    },

    /**
     * Drop every cached frame whose satId is NOT in `keep` — the worker calls this
     * after a bake with the current plan's satIds so stale frames (a feed/look that was
     * renamed or removed, e.g. the old plain `goes-east` before the disc×look split)
     * don't linger and bloat the collection. No-op when `keep` is empty (a failed bake
     * must never wipe the cache).
     */
    async pruneExcept(keep: string[]): Promise<{ removed: number }> {
      if (!keep.length) return { removed: 0 };
      // When FS-backed, collect the doomed satIds first so their on-disk bytes are
      // removed too; off-FS the bytes vanish with the doc, so skip the extra read.
      if (blobs.fs) {
        const doomed = await satImgModel
          .find({ satId: { $nin: keep } })
          .select({ satId: 1, _id: 0 })
          .lean<{ satId: string }[]>();
        await blobs.delete(doomed.map((d) => d.satId));
      }
      const res = await satImgModel.deleteMany({ satId: { $nin: keep } });
      return { removed: res.deletedCount ?? 0 };
    },

    async count(): Promise<{ satimg: number }> {
      const satimg = await satImgModel.estimatedDocumentCount();
      return { satimg };
    },
  };
}

export type SatImgRepo = ReturnType<typeof makeSatImgRepo>;
