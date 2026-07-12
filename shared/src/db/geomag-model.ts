import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { GeomagBounds } from "../geomag/types";

/**
 * The single baked geomagnetic-field (IGRF total intensity) frame. Near-static —
 * the field drifts only slowly (secular variation), so the worker re-bakes on a
 * slow cron and upserts the ONE singleton doc. The public app reads only this
 * cache: `png` is a SCALAR total-intensity texture the client colours on the GPU.
 */
export interface iGeomag extends iGeneralModel {
  /** Constant singleton key ("latest"). */
  frameId: string;
  epoch: number;
  year: number;
  nmax: number;
  bounds: GeomagBounds;
  width: number;
  height: number;
  minF: number;
  maxF: number;
  png: Buffer;
  contentType: string;
  fetchedAt: Date;
}

export interface iGeomagModel extends iGeomag {
  id: string;
  _id: string;
}

const GeomagSchema = new mongoose.Schema<iGeomagModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    frameId: { type: String, required: true, unique: true },
    epoch: { type: Number, required: true },
    year: { type: Number, required: true },
    nmax: { type: Number, required: true, default: 1 },
    bounds: { type: [Number], required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    minF: { type: Number, required: true, default: 0 },
    maxF: { type: Number, required: true, default: 0 },
    png: { type: Buffer, required: false }, // may live on ${BLOB_DIR} when FS-backed
    contentType: { type: String, required: true, default: "image/png" },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

GeomagSchema.index({ frameId: 1 }, { unique: true, name: "geomag_frame_id_ix" });

export const getGeomagModel = (conn: Connection) =>
  getModel<iGeomagModel>(conn, "Geomag", GeomagSchema);
