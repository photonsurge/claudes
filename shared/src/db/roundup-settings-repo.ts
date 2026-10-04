import type { Model } from "mongoose";
import { sanitizeRoundupSettings, type RoundupSettings } from "../roundup-settings";
import { ROUNDUP_SETTINGS_ID, type iRoundupSettingsModel } from "./roundup-settings-model";

/**
 * Read/write the round-up schedule singleton. Read by the worker's hourly tick
 * and the admin page; written only from the admin page.
 */
export function makeRoundupSettingsRepo(model: Model<iRoundupSettingsModel>) {
  return {
    model,

    /** The settings in force. No document → the defaults (does NOT write — a read must never create state). Always sanitised. */
    async get(): Promise<RoundupSettings> {
      const doc = await model.findOne({ id: ROUNDUP_SETTINGS_ID }).lean<iRoundupSettingsModel>().exec();
      return sanitizeRoundupSettings(doc?.settings);
    },

    /** Sanitise `input`, upsert the singleton, return what was stored. */
    async save(input: unknown): Promise<RoundupSettings> {
      const settings = sanitizeRoundupSettings(input);
      await model
        .updateOne(
          { id: ROUNDUP_SETTINGS_ID },
          { $set: { settings }, $setOnInsert: { id: ROUNDUP_SETTINGS_ID } },
          { upsert: true },
        )
        .exec();
      return settings;
    },
  };
}

export type RoundupSettingsRepo = ReturnType<typeof makeRoundupSettingsRepo>;
