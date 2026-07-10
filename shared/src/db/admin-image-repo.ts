import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { AdminEntityType, AdminImage } from "../admin-content/types";
import type { iAdminImageModel } from "./admin-image-model";

const strip = (doc: any): iAdminImageModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iAdminImageModel;
};

/**
 * Coerce whatever Mongo hands back for a stored Buffer into real bytes (Node
 * Buffer / BSON Binary / Uint8Array). Shared shape with ad-repo/satimg-repo.
 */
function toBuffer(v: any): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v && v._bsontype === "Binary") return Buffer.from(v.buffer ?? v.value?.() ?? []);
  if (v && v.buffer instanceof Uint8Array) return Buffer.from(v.buffer);
  if (v instanceof Uint8Array) return Buffer.from(v);
  return Buffer.from(v ?? []);
}

/** Map a stored doc (blob projected out) to the wire `AdminImage`. */
export function toAdminImage(doc: iAdminImageModel): AdminImage {
  return {
    id: doc.id,
    entityType: doc.entityType,
    entityId: doc.entityId,
    contentType: doc.contentType,
    byteSize: doc.byteSize,
    caption: doc.caption || undefined,
    credit: doc.credit || undefined,
    primary: !!doc.primary,
    sort: doc.sort ?? 0,
    createdAt: doc.created ? new Date(doc.created).getTime() : undefined,
    updatedAt: doc.updated ? new Date(doc.updated).getTime() : undefined,
  };
}

/** The image bytes + metadata for a create. */
export interface AdminImageInput {
  data: Buffer;
  contentType: string;
  byteSize: number;
  caption?: string;
  credit?: string;
}

/** Patchable image metadata (never the bytes). */
export interface AdminImagePatch {
  caption?: string;
  credit?: string;
  sort?: number;
}

/**
 * Admin image persistence. Bytes never ship on list/detail reads
 * (`.select("-data")`); `getBytes` fetches only the blob for the serve route.
 * The first image added to an entity becomes its primary; deleting the primary
 * promotes the next image so an entity is never left with a gallery and no hero.
 */
export function makeAdminImageRepo(model: Model<iAdminImageModel>) {
  return {
    model,

    /** Every image for one entity, in display order (no bytes). */
    async list(entityType: AdminEntityType, entityId: string): Promise<AdminImage[]> {
      const docs = await model
        .find({ entityType, entityId })
        .select("-data")
        .sort({ sort: 1, created: 1 })
        .lean()
        .exec();
      return docs.map((d) => toAdminImage(strip(d)));
    },

    /** The primary image for one entity (no bytes), or null. */
    async primaryFor(entityType: AdminEntityType, entityId: string): Promise<AdminImage | null> {
      const doc = await model
        .findOne({ entityType, entityId, primary: true })
        .select("-data")
        .lean()
        .exec();
      return doc ? toAdminImage(strip(doc)) : null;
    },

    /** Batch: images for many entities of one type, grouped by entityId. */
    async listForEntities(
      entityType: AdminEntityType,
      entityIds: string[],
    ): Promise<Map<string, AdminImage[]>> {
      const out = new Map<string, AdminImage[]>();
      if (!entityIds.length) return out;
      const docs = await model
        .find({ entityType, entityId: { $in: entityIds } })
        .select("-data")
        .sort({ sort: 1, created: 1 })
        .lean()
        .exec();
      for (const d of docs) {
        const img = toAdminImage(strip(d));
        const arr = out.get(img.entityId) ?? [];
        arr.push(img);
        out.set(img.entityId, arr);
      }
      return out;
    },

    /**
     * Add one image to an entity. Becomes primary if it's the entity's first;
     * sort lands at the end of the gallery.
     */
    async add(
      entityType: AdminEntityType,
      entityId: string,
      m: AdminImageInput,
    ): Promise<AdminImage> {
      const existing = await model.countDocuments({ entityType, entityId }).exec();
      const last = await model
        .findOne({ entityType, entityId })
        .select("sort")
        .sort({ sort: -1 })
        .lean()
        .exec();
      const id = uuidv4();
      await model.create({
        id,
        entityType,
        entityId,
        contentType: m.contentType,
        byteSize: m.byteSize,
        caption: m.caption,
        credit: m.credit,
        primary: existing === 0,
        sort: (last?.sort ?? -1) + 1,
        data: m.data,
      });
      const doc = await model.findOne({ id }).select("-data").lean().exec();
      if (!doc) throw new Error("admin image add: readback failed");
      return toAdminImage(strip(doc));
    },

    /** The image bytes for the serve route, or null if missing/empty. */
    async getBytes(
      id: string,
    ): Promise<{ data: Buffer; contentType: string; updatedAt: string } | null> {
      const doc = await model.findOne({ id }).exec();
      if (!doc || !doc.data) return null;
      const data = toBuffer(doc.data);
      if (!data.length) return null;
      const stamp = doc.updated ?? doc.created ?? new Date();
      return { data, contentType: doc.contentType, updatedAt: new Date(stamp).toISOString() };
    },

    /** Patch caption/credit/sort; returns the updated image or null. */
    async patch(id: string, patch: AdminImagePatch): Promise<AdminImage | null> {
      const set: Record<string, unknown> = {};
      if (patch.caption !== undefined) set.caption = patch.caption;
      if (patch.credit !== undefined) set.credit = patch.credit;
      if (patch.sort !== undefined) set.sort = patch.sort;
      if (Object.keys(set).length === 0) {
        const cur = await model.findOne({ id }).select("-data").lean().exec();
        return cur ? toAdminImage(strip(cur)) : null;
      }
      const doc = await model
        .findOneAndUpdate({ id }, { $set: set }, { new: true })
        .select("-data")
        .lean()
        .exec();
      return doc ? toAdminImage(strip(doc)) : null;
    },

    /** Make one image the entity's primary; clears the flag on its siblings. */
    async setPrimary(id: string): Promise<AdminImage | null> {
      const target = await model.findOne({ id }).select("-data").lean().exec();
      if (!target) return null;
      await model
        .updateMany(
          { entityType: target.entityType, entityId: target.entityId, id: { $ne: id } },
          { $set: { primary: false } },
        )
        .exec();
      const doc = await model
        .findOneAndUpdate({ id }, { $set: { primary: true } }, { new: true })
        .select("-data")
        .lean()
        .exec();
      return doc ? toAdminImage(strip(doc)) : null;
    },

    /** Delete one image; promotes the next image to primary if it was the hero. */
    async remove(id: string): Promise<boolean> {
      const target = await model.findOne({ id }).select("-data").lean().exec();
      if (!target) return false;
      await model.deleteOne({ id }).exec();
      if (target.primary) {
        const next = await model
          .findOne({ entityType: target.entityType, entityId: target.entityId })
          .select("-data")
          .sort({ sort: 1, created: 1 })
          .lean()
          .exec();
        if (next) await model.updateOne({ id: next.id }, { $set: { primary: true } }).exec();
      }
      return true;
    },

    /** Remove every image for an entity (e.g. when the entity is deleted). */
    async removeForEntity(entityType: AdminEntityType, entityId: string): Promise<number> {
      const res = await model.deleteMany({ entityType, entityId }).exec();
      return res.deletedCount ?? 0;
    },
  };
}

export type AdminImageRepo = ReturnType<typeof makeAdminImageRepo>;
