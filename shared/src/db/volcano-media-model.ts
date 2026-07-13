import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import { VOLCANO_MEDIA_SOURCES, VOLCANO_MEDIA_TYPES, type VolcanoMediaSource, type VolcanoMediaType } from "../volcanoes/media";

export interface iVolcanoMedia extends iGeneralModel {
  volcanoId: string; source: VolcanoMediaSource; type: VolcanoMediaType;
  sourceMediaId?: string; cameraId?: string; title?: string; caption?: string;
  observedAt?: Date; publishedAt?: Date; acquiredAt: Date; imageUrl?: string; sourceUrl: string;
  latitude?: number; longitude?: number; bearing?: number; attribution?: string; licence?: string;
  reuseAllowed?: boolean; contentHash?: string; perceptualHash?: string; rawPayloadRef?: string;
  assetRef?: string; contentType?: string; data?: Buffer;
}
export interface iVolcanoMediaModel extends iVolcanoMedia { id: string; _id: string }

const VolcanoMediaSchema = new mongoose.Schema<iVolcanoMediaModel>({
  id: { type: String, required: true, unique: true, default: () => uuidv4() },
  volcanoId: { type: String, required: true },
  source: { type: String, enum: VOLCANO_MEDIA_SOURCES, required: true },
  type: { type: String, enum: VOLCANO_MEDIA_TYPES, required: true },
  sourceMediaId: String, cameraId: String, title: String, caption: String,
  observedAt: Date, publishedAt: Date, acquiredAt: { type: Date, required: true, default: () => new Date() },
  imageUrl: String, sourceUrl: { type: String, required: true }, latitude: Number, longitude: Number, bearing: Number,
  attribution: String, licence: String, reuseAllowed: Boolean, contentHash: String, perceptualHash: String,
  rawPayloadRef: String, assetRef: String, contentType: String, data: Buffer,
}, mongoTimestamps);

VolcanoMediaSchema.index({ source: 1, sourceMediaId: 1 }, { unique: true, sparse: true, name: "volcano_media_source_ix" });
VolcanoMediaSchema.index({ cameraId: 1, contentHash: 1 }, { unique: true, sparse: true, name: "volcano_media_frame_ix" });
VolcanoMediaSchema.index({ volcanoId: 1, observedAt: -1, acquiredAt: -1 }, { name: "volcano_media_volcano_ix" });

export const getVolcanoMediaModel = (conn: Connection) => getModel<iVolcanoMediaModel>(conn, "VolcanoMedia", VolcanoMediaSchema);
