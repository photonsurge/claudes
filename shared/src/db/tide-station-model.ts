import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { TideProvider } from "../tides/types";

/**
 * Cached tide-gauge catalog (IOC + future providers). Near-static reference data,
 * refreshed on a slow cron; the worker `replace`s the whole set each refresh. A
 * `2dsphere` index on `loc` powers "nearest station to this event" lookups.
 */
export interface iTideStation extends iGeneralModel {
  /** `${provider}:${stationId}` — the upsert key (stable, provider-scoped). */
  key: string;
  stationId: string;
  provider: TideProvider;
  name: string;
  lng: number;
  lat: number;
  country?: string;
  sensor?: string;
  fetchedAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iTideStationModel extends iTideStation {
  id: string;
  _id: string;
}

const TideStationSchema = new mongoose.Schema<iTideStationModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    key: { type: String, required: true, unique: true },
    stationId: { type: String, required: true },
    provider: { type: String, required: true },
    name: { type: String, required: true },
    lng: { type: Number, required: true },
    lat: { type: Number, required: true },
    country: { type: String, required: false },
    sensor: { type: String, required: false },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

TideStationSchema.index({ key: 1 }, { unique: true, name: "tide_station_key_ix" });
TideStationSchema.index({ loc: "2dsphere" }, { name: "tide_station_geo_ix", sparse: true });

export const getTideStationModel = (conn: Connection) =>
  getModel<iTideStationModel>(conn, "TideStation", TideStationSchema);
