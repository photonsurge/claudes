import type { Model } from "mongoose";
import type { AuroraBounds, AuroraMeta } from "../aurora/types";
import type { iAuroraModel } from "./aurora-model";
import type { InlineBlobStore } from "./inline-blob";

/** The one singleton key — there is only ever a single cached aurora frame. */
const LATEST = "latest";

/** Everything the worker hands the repo for one baked frame. */
export interface AuroraBakeInput {
  observationTime: Date;
  forecastTime: Date;
  bounds: AuroraBounds;
  width: number;
  height: number;
  maxProb: number;
  kp?: number | null;
  kpTime?: Date | null;
  png: Buffer;
  contentType?: string;
}

const toMeta = (doc: any): AuroraMeta => ({
  observationTime: new Date(doc.observationTime).toISOString(),
  forecastTime: new Date(doc.forecastTime).toISOString(),
  bounds: doc.bounds as AuroraBounds,
  width: doc.width,
  height: doc.height,
  maxProb: doc.maxProb ?? 0,
  kp: doc.kp ?? null,
  kpTime: doc.kpTime ? new Date(doc.kpTime).toISOString() : null,
  updatedAt: new Date(doc.fetchedAt).toISOString(),
});

/**
 * Aurora-frame persistence + overlay reads. The worker `replace`s the ONE cached
 * frame on each OVATION bake (upsert on the constant singleton key). Reads split
 * in two so the metadata endpoint never ships the PNG bytes: `latest()` projects
 * the blob out; `latestPng()` fetches only the blob for the image route.
 */
export function makeAuroraRepo(auroraModel: Model<iAuroraModel>, blobs: InlineBlobStore) {
  return {
    auroraModel,

    /** Replace the single cached frame with a freshly baked one. */
    async replace(frame: AuroraBakeInput): Promise<{ maxProb: number }> {
      // Bytes to disk first (when FS-backed), so a reader never sees fresh meta
      // pointing at stale/absent pixels; the doc keeps them inline only off-FS.
      await blobs.put(LATEST, frame.png);
      await auroraModel.updateOne(
        { frameId: LATEST },
        {
          $set: {
            observationTime: frame.observationTime,
            forecastTime: frame.forecastTime,
            bounds: frame.bounds,
            width: frame.width,
            height: frame.height,
            maxProb: frame.maxProb,
            kp: frame.kp ?? null,
            kpTime: frame.kpTime ?? null,
            png: blobs.inlineValue(frame.png),
            contentType: frame.contentType ?? "image/png",
            fetchedAt: new Date(),
          },
          $setOnInsert: { id: LATEST, frameId: LATEST },
        },
        { upsert: true },
      );
      return { maxProb: frame.maxProb };
    },

    /** Frame metadata for the overlay hook (no pixel bytes), or null if unbaked. */
    async latest(): Promise<{ aurora: AuroraMeta | null }> {
      const doc = await auroraModel
        .findOne({ frameId: LATEST })
        .select("-png")
        .lean()
        .exec();
      return { aurora: doc ? toMeta(doc) : null };
    },

    /** The baked PNG bytes for the image route, or null if unbaked. */
    async latestPng(): Promise<{ data: Buffer; contentType: string; updatedAt: string } | null> {
      // No `.lean()` so Mongoose casts an inline `png` back to a real Buffer; the
      // blob store reads disk-first and only falls back to that inline value.
      const doc = await auroraModel.findOne({ frameId: LATEST }).exec();
      if (!doc) return null;
      const data = await blobs.get(LATEST, doc.png);
      if (!data || !data.length) return null;
      return {
        data,
        contentType: doc.contentType ?? "image/png",
        updatedAt: new Date(doc.fetchedAt).toISOString(),
      };
    },

    async count(): Promise<{ aurora: number }> {
      const aurora = await auroraModel.estimatedDocumentCount();
      return { aurora };
    },
  };
}

export type AuroraRepo = ReturnType<typeof makeAuroraRepo>;
