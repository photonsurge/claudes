import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Cached submarine-cable landing stations (TeleGeography). The coastal points
 * where cables come ashore — drawn as dots + labels on the globe. Upserted on
 * the stable `landingId`; same near-static, worker-only-write rule as cables.
 */
export interface iCableLanding extends iGeneralModel {
  /** TeleGeography slug — the upsert key. */
  landingId: string;
  name: string;
  lng: number;
  lat: number;
  fetchedAt: Date;
}

export interface iCableLandingModel extends iCableLanding {
  id: string;
  _id: string;
}

const CableLandingSchema = new mongoose.Schema<iCableLandingModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    landingId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    lng: { type: Number, required: true },
    lat: { type: Number, required: true },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

CableLandingSchema.index({ landingId: 1 }, { unique: true, name: "cable_landing_id_ix" });

export const getCableLandingModel = (conn: Connection) =>
  getModel<iCableLandingModel>(conn, "CableLanding", CableLandingSchema);
