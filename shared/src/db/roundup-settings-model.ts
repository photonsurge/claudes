import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { RoundupSettings } from "../roundup-settings";

/**
 * Which AI round-ups run and at which hours (see roundup-settings.ts). A
 * singleton: the schedule is channel-wide, because round-ups are generated once
 * and shared by every scene.
 */
export const ROUNDUP_SETTINGS_ID = "default" as const;

export interface iRoundupSettings extends iGeneralModel {
  id: string;
  settings: RoundupSettings;
}

export interface iRoundupSettingsModel extends iRoundupSettings {
  id: string;
  _id: string;
}

const RoundupSettingsSchema = new mongoose.Schema<iRoundupSettingsModel>(
  {
    id: { type: String, required: true, unique: true, default: ROUNDUP_SETTINGS_ID },
    // Mixed: the shape is owned by sanitizeRoundupSettings, which runs on every
    // read and write. Declaring it here too would be a second place to update
    // when a round-up is added — and the sanitiser already tolerates old docs.
    settings: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
  },
  mongoTimestamps,
);

export const getRoundupSettingsModel = (conn: Connection) =>
  getModel<iRoundupSettingsModel>(conn, "RoundupSettings", RoundupSettingsSchema);
