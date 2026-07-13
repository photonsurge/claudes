import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import { VOLCANO_MEDIA_SOURCES, type VolcanoMediaSource } from "../volcanoes/media";

/** Operational registry for each enrichment adapter (not the volcano crosswalk). */
export interface iVolcanoMediaSource extends iGeneralModel {
  source: VolcanoMediaSource;
  name: string;
  registryUrl: string;
  enabled: boolean;
  registryPollSeconds: number;
  mediaPollSeconds?: number;
  attribution?: string;
  defaultLicence?: string;
  defaultReuseAllowed?: boolean;
  lastDiscoveredAt?: Date;
  lastError?: string;
}
export interface iVolcanoMediaSourceModel extends iVolcanoMediaSource { id: string; _id: string }

const VolcanoMediaSourceSchema = new mongoose.Schema<iVolcanoMediaSourceModel>({
  id: { type: String, required: true, unique: true, default: () => uuidv4() },
  source: { type: String, enum: VOLCANO_MEDIA_SOURCES, required: true, unique: true },
  name: { type: String, required: true },
  registryUrl: { type: String, required: true },
  enabled: { type: Boolean, required: true, default: true },
  registryPollSeconds: { type: Number, required: true },
  mediaPollSeconds: Number,
  attribution: String,
  defaultLicence: String,
  defaultReuseAllowed: Boolean,
  lastDiscoveredAt: Date,
  lastError: String,
}, mongoTimestamps);

VolcanoMediaSourceSchema.index({ source: 1 }, { unique: true, name: "volcano_media_source_ix" });
export const getVolcanoMediaSourceModel = (conn: Connection) =>
  getModel<iVolcanoMediaSourceModel>(conn, "VolcanoMediaSource", VolcanoMediaSourceSchema);
