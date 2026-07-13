import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import { VOLCANO_MEDIA_SOURCES, type VolcanoCameraMode, type VolcanoMediaSource } from "../volcanoes/media";

export interface iVolcanoCamera extends iGeneralModel {
  volcanoId: string;
  source: VolcanoMediaSource;
  sourceCameraId: string;
  name: string;
  mode: VolcanoCameraMode;
  latitude?: number;
  longitude?: number;
  bearing?: number;
  currentImageUrl?: string;
  detailUrl: string;
  videoUrl?: string;
  upstreamTimestamp?: string;
  attribution?: string;
  licence?: string;
  reuseAllowed?: boolean;
  enabled: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface iVolcanoCameraModel extends iVolcanoCamera { id: string; _id: string }

const VolcanoCameraSchema = new mongoose.Schema<iVolcanoCameraModel>({
  id: { type: String, required: true, unique: true, default: () => uuidv4() },
  volcanoId: { type: String, required: true },
  source: { type: String, enum: VOLCANO_MEDIA_SOURCES, required: true },
  sourceCameraId: { type: String, required: true },
  name: { type: String, required: true },
  mode: { type: String, enum: ["VISIBLE", "THERMAL", "IR", "LOW_LIGHT", "UNKNOWN"], required: true },
  latitude: Number,
  longitude: Number,
  bearing: Number,
  currentImageUrl: String,
  detailUrl: { type: String, required: true },
  videoUrl: String,
  upstreamTimestamp: String,
  attribution: String,
  licence: String,
  reuseAllowed: Boolean,
  enabled: { type: Boolean, required: true, default: true },
  firstSeenAt: { type: Date, required: true, default: () => new Date() },
  lastSeenAt: { type: Date, required: true, default: () => new Date() },
}, mongoTimestamps);

VolcanoCameraSchema.index({ source: 1, sourceCameraId: 1 }, { unique: true, name: "volcano_camera_source_ix" });
VolcanoCameraSchema.index({ volcanoId: 1, enabled: 1 }, { name: "volcano_camera_volcano_ix" });

export const getVolcanoCameraModel = (conn: Connection) => getModel<iVolcanoCameraModel>(conn, "VolcanoCamera", VolcanoCameraSchema);
