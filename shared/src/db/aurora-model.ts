import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { AuroraBounds } from "../aurora/types";

/**
 * The single most-recent baked aurora frame (NOAA SWPC OVATION Prime). Unlike the
 * static plate boundaries, this rolls over every few minutes as geomagnetic
 * activity changes — the worker re-bakes on a fast cron and upserts the ONE
 * singleton doc (`frameId: "latest"`). The public app reads only this cache: the
 * `png` blob is the pre-coloured translucent glow served straight to a BitmapLayer.
 */
export interface iAurora extends iGeneralModel {
  /** Constant singleton key ("latest") — always exactly one frame cached. */
  frameId: string;
  observationTime: Date;
  forecastTime: Date;
  bounds: AuroraBounds;
  width: number;
  height: number;
  /** Peak probability across the grid (%, 0–100). */
  maxProb: number;
  /** Latest planetary Kp index (0–9), or null when the Kp feed was unavailable. */
  kp: number | null;
  /** Time of the latest Kp reading, or null. */
  kpTime: Date | null;
  /** The baked, pre-coloured RGBA glow PNG. */
  png: Buffer;
  contentType: string;
  fetchedAt: Date;
}

export interface iAuroraModel extends iAurora {
  id: string;
  _id: string;
}

const AuroraSchema = new mongoose.Schema<iAuroraModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    frameId: { type: String, required: true, unique: true },
    observationTime: { type: Date, required: true },
    forecastTime: { type: Date, required: true },
    bounds: { type: [Number], required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    maxProb: { type: Number, required: true, default: 0 },
    kp: { type: Number, required: false, default: null },
    kpTime: { type: Date, required: false, default: null },
    png: { type: Buffer, required: true },
    contentType: { type: String, required: true, default: "image/png" },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

AuroraSchema.index({ frameId: 1 }, { unique: true, name: "aurora_frame_id_ix" });

export const getAuroraModel = (conn: Connection) =>
  getModel<iAuroraModel>(conn, "Aurora", AuroraSchema);
