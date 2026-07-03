import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { ClimateDataset } from "../climate/types";

/**
 * Worker-cached past-year ERA5 climate for one focus point. One doc per 0.1°
 * rounded point, UPSERTED on `key` — the worker's climate job fetches for
 * whatever's on air; the public /climate route reads only the nearest cached
 * doc. A TTL on `fetchedAt` drops points the broadcast stopped visiting; a
 * `2dsphere` index powers the nearest-doc query.
 */
const TTL_SEC = Number(process.env.CLIMATE_TTL_SEC || 14 * 24 * 60 * 60);

export interface iClimateYear extends iGeneralModel {
  /** `climateKey(lat, lng)` — the upsert key. */
  key: string;
  lat: number;
  lng: number;
  /** ISO YYYY-MM-DD, oldest first, ~365 entries. */
  dates: string[];
  datasets: ClimateDataset[];
  fetchedAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iClimateYearModel extends iClimateYear {
  id: string;
  _id: string;
}

const ClimateYearSchema = new mongoose.Schema<iClimateYearModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    key: { type: String, required: true, unique: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    dates: { type: [String], required: true, default: [] },
    datasets: { type: mongoose.Schema.Types.Mixed, required: true, default: [] },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

ClimateYearSchema.index({ key: 1 }, { unique: true, name: "climate_year_key_ix" });
ClimateYearSchema.index({ loc: "2dsphere" }, { name: "climate_year_geo_ix", sparse: true });
// Roll off points the worker stopped refreshing once the focus moved away.
ClimateYearSchema.index({ fetchedAt: 1 }, { name: "climate_year_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getClimateYearModel = (conn: Connection) =>
  getModel<iClimateYearModel>(conn, "ClimateYear", ClimateYearSchema);
