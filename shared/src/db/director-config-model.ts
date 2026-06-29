import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { DirectorConfig } from "../director";

/** Single-domain → one director-config document. */
export const DIRECTOR_CONFIG_ID = "default" as const;

export interface iDirectorConfig extends iGeneralModel, DirectorConfig {}

export interface iDirectorConfigModel extends iDirectorConfig {
  id: string;
  _id: string;
}

const DirectorConfigSchema = new mongoose.Schema<iDirectorConfigModel>(
  {
    id: { type: String, required: true, unique: true, default: DIRECTOR_CONFIG_ID },
    mode: { type: String, required: true, enum: ["off", "auto"], default: "off" },
    holdSeconds: { type: Number, required: true, default: 12 },
    kinds: {
      intro: { type: Boolean, default: true },
      tour: { type: Boolean, default: true },
      weather: { type: Boolean, default: true },
      storm: { type: Boolean, default: true },
      quake: { type: Boolean, default: true },
      flight: { type: Boolean, default: true },
      ship: { type: Boolean, default: true },
    },
    minQuakeMag: { type: Number, required: true, default: 4.5 },
    minAlertSeverity: { type: Number, required: true, default: 3 },
    skipNonce: { type: Number, required: true, default: 0 },
  },
  mongoTimestamps,
);

export const getDirectorConfigModel = (conn: Connection) =>
  getModel<iDirectorConfigModel>(conn, "DirectorConfig", DirectorConfigSchema);
