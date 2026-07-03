import type { Model } from "mongoose";
import type { AuroraBounds, AuroraMeta } from "../aurora/types";
import type { iAuroraModel } from "./aurora-model";

/** The one singleton key — there is only ever a single cached aurora frame. */
const LATEST = "latest";

/**
 * Coerce whatever Mongo hands back for a stored Buffer field into real PNG bytes.
 * Depending on `.lean()` + the driver's `promoteBuffers` setting, `png` can come
 * back as a Node Buffer, a BSON `Binary` (subtype 0, bytes on `.buffer`), or a
 * plain Uint8Array. `Buffer.from(binary)` on a BSON Binary yields GARBAGE (the
 * browser then fails with "source image could not be decoded"), so normalise here.
 */
function toPngBuffer(v: any): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v && v._bsontype === "Binary") return Buffer.from(v.buffer ?? v.value?.() ?? []);
  if (v && v.buffer instanceof Uint8Array) return Buffer.from(v.buffer);
  if (v instanceof Uint8Array) return Buffer.from(v);
  return Buffer.from(v ?? []);
}

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
export function makeAuroraRepo(auroraModel: Model<iAuroraModel>) {
  return {
    auroraModel,

    /** Replace the single cached frame with a freshly baked one. */
    async replace(frame: AuroraBakeInput): Promise<{ maxProb: number }> {
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
            png: frame.png,
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
      // No `.lean()` so Mongoose casts `png` back to a real Buffer; `toPngBuffer`
      // still guards the Binary/Uint8Array cases defensively.
      const doc = await auroraModel.findOne({ frameId: LATEST }).exec();
      if (!doc || !doc.png) return null;
      const data = toPngBuffer(doc.png);
      if (!data.length) return null;
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
