import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { Ad, AdMediaType, AdMeta, AdStatus, AdStorage } from "../ads/types";
import { pickAdForAir } from "../ads/select";
import type { iAdModel } from "./ad-model";

const strip = (doc: any): iAdModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iAdModel;
};

/**
 * Coerce whatever Mongo hands back for a stored Buffer field into real bytes.
 * With `.lean()` (or across bson versions) a Buffer can come back as a Node
 * Buffer, a BSON `Binary` (bytes on `.buffer`), or a plain Uint8Array; a naive
 * `Buffer.from` on a Binary yields garbage. (Shared shape with satimg-repo.)
 */
function toBuffer(v: any): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v && v._bsontype === "Binary") return Buffer.from(v.buffer ?? v.value?.() ?? []);
  if (v && v.buffer instanceof Uint8Array) return Buffer.from(v.buffer);
  if (v instanceof Uint8Array) return Buffer.from(v);
  return Buffer.from(v ?? []);
}

/** Map a stored doc (blob projected out) to the wire `Ad`. */
export function toAd(doc: iAdModel): Ad {
  return {
    adId: doc.adId,
    title: doc.title,
    status: doc.status,
    mediaType: doc.mediaType,
    contentType: doc.contentType,
    byteSize: doc.byteSize,
    width: doc.width,
    height: doc.height,
    advertiser: doc.advertiser,
    clickUrl: doc.clickUrl,
    weight: doc.weight,
    tags: doc.tags && doc.tags.length ? doc.tags : undefined,
    notes: doc.notes,
    storage: doc.storage,
    createdAt: doc.created ? new Date(doc.created).getTime() : undefined,
    updatedAt: doc.updated ? new Date(doc.updated).getTime() : undefined,
    lastShownAt: doc.lastShownAt ? new Date(doc.lastShownAt).getTime() : undefined,
    timesShown: doc.timesShown ?? 0,
    totalDisplayMs: doc.totalDisplayMs ?? 0,
  };
}

/** The media bytes + kind for a create or a media replacement. */
export interface AdMediaInput {
  data: Buffer;
  contentType: string;
  mediaType: AdMediaType;
  byteSize: number;
  width?: number;
  height?: number;
  storage?: AdStorage;
}

export type AdCreateInput = AdMeta & AdMediaInput & { adId?: string };

/**
 * Ad persistence + admin reads. Reads split so list/detail never ship the media
 * bytes (`.select("-data")`); `getMedia` fetches only the blob for the serve
 * route. Create generates a UUID `adId`; edits target that id.
 */
export function makeAdRepo(model: Model<iAdModel>) {
  return {
    model,

    /** Create one ad with its media. Returns the canonical wire shape. */
    async create(input: AdCreateInput): Promise<Ad> {
      const adId = input.adId?.trim() || uuidv4();
      await model.create({
        id: uuidv4(),
        adId,
        title: input.title,
        status: input.status,
        mediaType: input.mediaType,
        contentType: input.contentType,
        byteSize: input.byteSize,
        width: input.width,
        height: input.height,
        advertiser: input.advertiser,
        clickUrl: input.clickUrl,
        weight: input.weight,
        tags: input.tags,
        notes: input.notes,
        storage: input.storage ?? "inline",
        data: input.data,
      });
      const doc = await model.findOne({ adId }).select("-data").lean().exec();
      if (!doc) throw new Error("ad create: readback failed");
      return toAd(strip(doc));
    },

    /** Ads (newest-edited first), optionally filtered by status / text. */
    async list(
      opts: { status?: AdStatus; q?: string; limit?: number } = {},
    ): Promise<Ad[]> {
      const query: Record<string, unknown> = {};
      if (opts.status) query.status = opts.status;
      if (opts.q) {
        const rx = new RegExp(opts.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        query.$or = [{ title: rx }, { advertiser: rx }];
      }
      const docs = await model
        .find(query)
        .select("-data")
        .sort({ updated: -1 })
        .limit(opts.limit ?? 0)
        .lean()
        .exec();
      return docs.map((d) => toAd(strip(d)));
    },

    /** A single ad by id (no bytes), or null. */
    async getByAdId(adId: string): Promise<Ad | null> {
      const doc = await model.findOne({ adId }).select("-data").lean().exec();
      return doc ? toAd(strip(doc)) : null;
    },

    /** The media bytes for the serve route, or null if missing/empty. */
    async getMedia(
      adId: string,
    ): Promise<{ data: Buffer; contentType: string; updatedAt: string } | null> {
      // No `.lean()` so Mongoose casts `data` back to a real Buffer; `toBuffer`
      // still guards the Binary/Uint8Array cases defensively.
      const doc = await model.findOne({ adId }).exec();
      if (!doc || !doc.data) return null;
      const data = toBuffer(doc.data);
      if (!data.length) return null;
      const stamp = doc.updated ?? doc.created ?? new Date();
      return {
        data,
        contentType: doc.contentType,
        updatedAt: new Date(stamp).toISOString(),
      };
    },

    /** Patch editable metadata; returns the updated ad or null. */
    async updateMeta(adId: string, patch: Partial<AdMeta>): Promise<Ad | null> {
      if (Object.keys(patch).length === 0) return this.getByAdId(adId);
      const doc = await model
        .findOneAndUpdate({ adId }, { $set: patch }, { new: true })
        .select("-data")
        .lean()
        .exec();
      return doc ? toAd(strip(doc)) : null;
    },

    /** Toggle/set status (admin toggle). */
    async setStatus(adId: string, status: AdStatus): Promise<Ad | null> {
      return this.updateMeta(adId, { status });
    },

    /** Swap the media bytes on an existing ad (keeps metadata + adId). */
    async replaceMedia(adId: string, m: AdMediaInput): Promise<Ad | null> {
      const doc = await model
        .findOneAndUpdate(
          { adId },
          {
            $set: {
              data: m.data,
              contentType: m.contentType,
              mediaType: m.mediaType,
              byteSize: m.byteSize,
              width: m.width,
              height: m.height,
              storage: m.storage ?? "inline",
            },
          },
          { new: true },
        )
        .select("-data")
        .lean()
        .exec();
      return doc ? toAd(strip(doc)) : null;
    },

    /**
     * Pick one active ad to air, rotating through every active ad before any
     * repeats (director commercial break). `excludeAdId` (the previous airing)
     * is a last-resort tiebreaker so two breaks in a row don't repeat the same
     * ad, unless it's the only active one. Returns null when nothing is
     * active. Pure selection lives in `pickAdForAir`; the repo just supplies
     * the active pool (no bytes).
     */
    async pickForAir(rng?: () => number, excludeAdId?: string): Promise<Ad | null> {
      const active = await this.list({ status: "active" });
      return pickAdForAir(active, rng, excludeAdId);
    },

    /**
     * Stamp an airing: set `lastShownAt` and bump `timesShown`. Called by the
     * director when an ad cut goes on air. Durable (survives worker restarts).
     */
    async markShown(adId: string, at: Date = new Date()): Promise<void> {
      await model
        .updateOne({ adId }, { $set: { lastShownAt: at }, $inc: { timesShown: 1 } })
        .exec();
    },

    /**
     * Add actual on-screen milliseconds for one airing. Called by the director
     * when the ad's cut ENDS (not when it starts), so a manual skip mid-break
     * records real dwell time rather than the nominal hold duration.
     */
    async recordImpression(adId: string, ms: number): Promise<void> {
      if (ms <= 0) return;
      await model.updateOne({ adId }, { $inc: { totalDisplayMs: ms } }).exec();
    },

    /** Delete an ad by id. Returns true if one was removed. */
    async remove(adId: string): Promise<boolean> {
      const res = await model.deleteOne({ adId }).exec();
      return (res.deletedCount ?? 0) > 0;
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type AdRepo = ReturnType<typeof makeAdRepo>;
