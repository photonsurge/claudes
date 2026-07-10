import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { AdminEntityType } from "../admin-content/types";

/**
 * An admin-uploaded image for a catalog/signal entity. Stored in its OWN
 * collection (not on the entity doc) so it survives feed refreshes — keyed by
 * `(entityType, entityId)` where `entityId` is the entity's stable id
 * (City.id, Country.countryId, Region.regionId, Volcano.volcanoId, Alert.id,
 * Quake.quakeId, SeismoStation.key). Bytes live inline as a Mongo Buffer (like
 * ads); the wire `AdminImage` carries only metadata + enough to build the media
 * URL. `updated` doubles as the media-URL cache-buster.
 */
export interface iAdminImage extends iGeneralModel {
  entityType: AdminEntityType;
  entityId: string;
  contentType: string;
  byteSize: number;
  caption?: string;
  credit?: string;
  /** Exactly one image per (entityType, entityId) is the primary/hero. */
  primary: boolean;
  /** Display order within the entity's gallery (ascending). */
  sort: number;
  /** Inline image bytes. */
  data: Buffer;
}

export interface iAdminImageModel extends iAdminImage {
  id: string;
  _id: string;
}

const AdminImageSchema = new mongoose.Schema<iAdminImageModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    contentType: { type: String, required: true },
    byteSize: { type: Number, required: true, default: 0 },
    caption: { type: String, required: false },
    credit: { type: String, required: false },
    primary: { type: Boolean, required: true, default: false },
    sort: { type: Number, required: true, default: 0 },
    data: { type: Buffer, required: false },
  },
  mongoTimestamps,
);

// The gallery read: every image for one entity, in display order.
AdminImageSchema.index({ entityType: 1, entityId: 1, sort: 1 }, { name: "admin_image_entity_ix" });

export const getAdminImageModel = (conn: Connection) =>
  getModel<iAdminImageModel>(conn, "AdminImage", AdminImageSchema);
