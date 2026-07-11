import mongoose, { Connection, Model } from "mongoose";
import { getModel } from "../utill/getModel";

/**
 * Externalised binary payload for a collection whose METADATA is scanned often.
 *
 * Why this exists: MongoDB/WiredTiger stores each document as one BSON blob, so
 * a projection like `.select({ data: 0 })` still reads the *entire* document —
 * multi-hundred-KB texture Buffer and all — off disk into the server's cache
 * before stripping the field for the wire. A frequent metadata scan of a
 * blob-bearing collection therefore pages the whole binary archive through
 * Mongo's working set even though nobody wanted the bytes.
 *
 * The fix is to keep the (small) metadata in its own collection and the (large)
 * bytes here, joined by `refId` only for the handful of docs actually sampled.
 * A metadata scan then never touches a blob; the bytes are fetched by id.
 */
export interface iBlobDoc {
  /** The public `id` of the metadata doc these bytes belong to. */
  refId: string;
  data: Buffer;
}

/** Register (or resolve) a blob sidecar collection by name. */
export function getBlobModel(conn: Connection, name: string): Model<iBlobDoc> {
  const schema = new mongoose.Schema<iBlobDoc>({
    refId: { type: String, required: true, unique: true },
    data: { type: Buffer, required: true },
  });
  return getModel<iBlobDoc>(conn, name, schema);
}

/**
 * Tiny key→bytes store over a sidecar collection. All access is by `refId`
 * (unique-indexed), so reads never scan and never pull bytes that weren't
 * asked for.
 */
export function makeBlobStore(model: Model<iBlobDoc>) {
  return {
    model,

    /** Write (or replace) the bytes for one ref. */
    async put(refId: string, data: Buffer): Promise<void> {
      await model.updateOne({ refId }, { $set: { data } }, { upsert: true });
    },

    /** Bytes for one ref, or null if absent. */
    async get(refId: string): Promise<Buffer | null> {
      const d = await model
        .findOne({ refId })
        .select({ data: 1, _id: 0 })
        .lean<Pick<iBlobDoc, "data">>();
      return d?.data ?? null;
    },

    /** Bytes for many refs in one round-trip, keyed by refId. */
    async getMany(refIds: string[]): Promise<Map<string, Buffer>> {
      if (!refIds.length) return new Map();
      const docs = await model
        .find({ refId: { $in: refIds } })
        .select({ refId: 1, data: 1, _id: 0 })
        .lean<iBlobDoc[]>();
      return new Map(docs.map((d) => [d.refId, d.data]));
    },

    /** Drop the bytes for these refs (paired with a metadata prune). */
    async delete(refIds: string[]): Promise<void> {
      if (refIds.length) await model.deleteMany({ refId: { $in: refIds } });
    },
  };
}

export type BlobStore = ReturnType<typeof makeBlobStore>;
