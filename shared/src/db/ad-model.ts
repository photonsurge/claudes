import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { AdMediaType, AdStatus, AdStorage } from "../ads/types";

/**
 * An advertisement: sponsor creative shown on the broadcast, managed from
 * /admin/ads. Like weather textures and satimg frames, the media bytes live
 * directly on the doc as a Mongo `Buffer` (`data`) — fine for images and short
 * clips under the 16 MB limit. Large video will move to GridFS: the `storage`
 * discriminator + optional `gridfsId` are already here so that path is additive.
 * `created`/`updated` come from `mongoTimestamps`; `updated` doubles as the
 * media-URL cache-buster.
 */
export interface iAd extends iGeneralModel {
  /** Stable id — the upsert/edit key (generated on create). */
  adId: string;
  title: string;
  status: AdStatus;
  mediaType: AdMediaType;
  contentType: string;
  byteSize: number;
  width?: number;
  height?: number;
  advertiser?: string;
  clickUrl?: string;
  weight: number;
  tags?: string[];
  notes?: string;
  storage: AdStorage;
  /** Inline media bytes (empty when `storage === "gridfs"`). */
  data: Buffer;
  /** GridFS file id when the bytes are stored out-of-doc (large video). */
  gridfsId?: string;
}

export interface iAdModel extends iAd {
  id: string;
  _id: string;
}

const AdSchema = new mongoose.Schema<iAdModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    adId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "inactive"],
      required: true,
      default: "active",
    },
    mediaType: { type: String, enum: ["image", "video"], required: true },
    contentType: { type: String, required: true },
    byteSize: { type: Number, required: true, default: 0 },
    width: { type: Number, required: false },
    height: { type: Number, required: false },
    advertiser: { type: String, required: false },
    clickUrl: { type: String, required: false },
    weight: { type: Number, required: true, default: 1 },
    tags: { type: [String], required: false },
    notes: { type: String, required: false },
    storage: {
      type: String,
      enum: ["inline", "gridfs"],
      required: true,
      default: "inline",
    },
    data: { type: Buffer, required: false },
    gridfsId: { type: String, required: false },
  },
  mongoTimestamps,
);

AdSchema.index({ adId: 1 }, { unique: true, name: "ad_id_ix" });
// Admin list reads newest-edited-first, filterable by status.
AdSchema.index({ status: 1, updated: -1 }, { name: "ad_status_ix" });

export const getAdModel = (conn: Connection) =>
  getModel<iAdModel>(conn, "Ad", AdSchema);
