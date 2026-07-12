import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { SatImgBounds } from "../satimg/types";

/**
 * The single most-recent baked satellite-imagery frame PER bird. Keyed by `satId`
 * (the registry slug, e.g. "himawari9") so each geostationary satellite upserts its
 * own singleton doc; the worker re-bakes on a fast cron and the public app reads
 * only this cache. The `png` blob is the reprojected full-globe RGBA image served
 * straight to a BitmapLayer (transparent outside the satellite's disk).
 */
export interface iSatImg extends iGeneralModel {
  /** Bird slug — the per-satellite singleton key (e.g. "himawari9"). */
  satId: string;
  /** Display name, e.g. "Himawari-9". */
  satName: string;
  /** Sub-satellite longitude (°E). */
  subLon: number;
  /** satpy composite/band baked, e.g. "true_color" or "B13". */
  composite: string;
  /** Nominal scan-slot / observation time. */
  observationTime: Date;
  /** Geographic extent of the baked PNG (full globe). */
  bounds: SatImgBounds;
  width: number;
  height: number;
  /** The baked, reprojected RGBA PNG (transparent outside the disk). */
  png: Buffer;
  contentType: string;
  fetchedAt: Date;
}

export interface iSatImgModel extends iSatImg {
  id: string;
  _id: string;
}

const SatImgSchema = new mongoose.Schema<iSatImgModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    satId: { type: String, required: true, unique: true },
    satName: { type: String, required: true },
    subLon: { type: Number, required: true },
    composite: { type: String, required: true, default: "true_color" },
    observationTime: { type: Date, required: true },
    bounds: { type: [Number], required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    png: { type: Buffer, required: false }, // may live on ${BLOB_DIR} when FS-backed
    contentType: { type: String, required: true, default: "image/png" },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

SatImgSchema.index({ satId: 1 }, { unique: true, name: "satimg_sat_id_ix" });

export const getSatImgModel = (conn: Connection) =>
  getModel<iSatImgModel>(conn, "SatImg", SatImgSchema);
