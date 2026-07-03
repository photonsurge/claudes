import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Cached NASA FIRMS active-fire detections. Like earthquakes, these are discrete
 * point-in-time events: the worker UPSERTS on the minted `fireId` (a re-poll of an
 * overlapping window refreshes without duplicating) and a TTL on `acqTime` expires
 * old detections so the collection tracks the rolling FIRMS window (a few days).
 */
const TTL_SEC = Number(process.env.FIRE_TTL_SEC || 7 * 24 * 60 * 60);

export interface iFire extends iGeneralModel {
  /** Minted FIRMS detection id (the upsert key). */
  fireId: string;
  lat: number;
  lng: number;
  frp: number;
  brightness: number;
  confidence: number;
  acqTime: Date;
  daynight: string;
  satellite: string;
  fetchedAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iFireModel extends iFire {
  id: string;
  _id: string;
}

const FireSchema = new mongoose.Schema<iFireModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    fireId: { type: String, required: true, unique: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    frp: { type: Number, required: true, default: 0 },
    brightness: { type: Number, required: true, default: 0 },
    confidence: { type: Number, required: true, default: 0 },
    acqTime: { type: Date, required: true },
    daynight: { type: String, required: false, default: "" },
    satellite: { type: String, required: false, default: "" },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

FireSchema.index({ fireId: 1 }, { unique: true, name: "fire_id_ix" });
// Overlay reads newest-first, filtered by fire radiative power.
FireSchema.index({ acqTime: -1, frp: -1 }, { name: "fire_time_frp_ix" });
FireSchema.index({ loc: "2dsphere" }, { name: "fire_geo_ix", sparse: true });
// Auto-expire detections that have rolled out of the FIRMS window.
FireSchema.index({ acqTime: 1 }, { name: "fire_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getFireModel = (conn: Connection) =>
  getModel<iFireModel>(conn, "Fire", FireSchema);
