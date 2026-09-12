import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * A sponsor-exposure window: one continuous stretch during which one ad was
 * airing on one continuous surface of one scene — the ticker's "Sponsored
 * by …" mention (`surface: "ticker"`) or the bottom-left corner rotation
 * (`surface: "billboard"`). Written ONLY by the worker's `ads.exposure` reconcile
 * sweep (see shared/ads/exposure.ts for the open/close/heartbeat rules);
 * /admin/ads reads it for the "what aired where and when" ticker log.
 * An unset `endedAt` means the window is still airing right now.
 */

/** Continuous surfaces that log exposure windows (ad breaks use the as-run log). */
export type AdExposureSurface = "ticker" | "billboard" | "alertSlot";

/** Every logged surface, for sweeps and rollups that walk them all. */
export const AD_EXPOSURE_SURFACES: readonly AdExposureSurface[] = ["ticker", "billboard", "alertSlot"];

export interface iAdExposure extends iGeneralModel {
  adId: string;
  sceneId: string;
  surface: AdExposureSurface;
  startedAt: Date;
  /** Unset while the window is open (the pair is airing right now). */
  endedAt?: Date;
  /** The reconcile sweep's heartbeat — the close point if the worker dies. */
  lastSeenAt: Date;
}

export interface iAdExposureModel extends iAdExposure {
  id: string;
  _id: string;
}

const AdExposureSchema = new mongoose.Schema<iAdExposureModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    adId: { type: String, required: true },
    sceneId: { type: String, required: true },
    surface: { type: String, enum: [...AD_EXPOSURE_SURFACES], required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: false },
    lastSeenAt: { type: Date, required: true },
  },
  mongoTimestamps,
);

// The sweep's working set: open windows (endedAt unset) per surface.
AdExposureSchema.index({ surface: 1, endedAt: 1 }, { name: "ad_exposure_open_ix" });
// Per-ad history, newest first (the admin ticker log).
AdExposureSchema.index({ adId: 1, startedAt: -1 }, { name: "ad_exposure_ad_ix" });

export const getAdExposureModel = (conn: Connection) =>
  getModel<iAdExposureModel>(conn, "AdExposure", AdExposureSchema);
