import mongoose, { Connection, Model } from "mongoose";
import { getModel } from "../utill/getModel";
import type { BlobFs } from "./blob-fs";

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
 * Where a blob store keeps its bytes. Without `fs` it is pure Mongo (the sidecar
 * collection). With `fs` set, bytes are written to the shared `${BLOB_DIR}`
 * folder under the given namespace and reads are FS-first with a Mongo fallback —
 * so a store mid-migration transparently serves whatever has already moved to
 * disk while still finding the rest in Mongo. See {@link BlobFs}.
 */
export interface BlobStoreOpts {
  fs?: BlobFs | null;
  /** Namespace (subdirectory) for this collection's blobs on disk. */
  ns?: string;
}

/**
 * Tiny key→bytes store over a sidecar collection, optionally backed by the
 * shared filesystem. All access is by `refId` (unique-indexed in Mongo, the
 * file key on disk), so reads never scan and never pull bytes that weren't
 * asked for.
 */
export function makeBlobStore(model: Model<iBlobDoc>, opts: BlobStoreOpts = {}) {
  const fs = opts.fs ?? null;
  const ns = opts.ns ?? model.modelName;

  return {
    model,
    fs,
    ns,

    /** Write (or replace) the bytes for one ref — to disk when FS-backed. */
    async put(refId: string, data: Buffer): Promise<void> {
      if (fs) {
        await fs.put(ns, refId, data);
        return;
      }
      await model.updateOne({ refId }, { $set: { data } }, { upsert: true });
    },

    /** Bytes for one ref, or null if absent. FS-first, then Mongo. */
    async get(refId: string): Promise<Buffer | null> {
      if (fs) {
        const onDisk = await fs.get(ns, refId);
        if (onDisk) return onDisk;
      }
      const d = await model
        .findOne({ refId })
        .select({ data: 1, _id: 0 })
        .lean<Pick<iBlobDoc, "data">>();
      return d?.data ?? null;
    },

    /** Bytes for many refs, keyed by refId. FS-first; Mongo covers any misses. */
    async getMany(refIds: string[]): Promise<Map<string, Buffer>> {
      if (!refIds.length) return new Map();
      const out = fs ? await fs.getMany(ns, refIds) : new Map<string, Buffer>();
      const missing = fs ? refIds.filter((id) => !out.has(id)) : refIds;
      if (missing.length) {
        const docs = await model
          .find({ refId: { $in: missing } })
          .select({ refId: 1, data: 1, _id: 0 })
          .lean<iBlobDoc[]>();
        for (const d of docs) out.set(d.refId, d.data);
      }
      return out;
    },

    /** Drop the bytes for these refs from BOTH backings (paired with a prune). */
    async delete(refIds: string[]): Promise<void> {
      if (!refIds.length) return;
      if (fs) await fs.delete(ns, refIds);
      await model.deleteMany({ refId: { $in: refIds } });
    },
  };
}

export type BlobStore = ReturnType<typeof makeBlobStore>;
