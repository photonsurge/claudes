import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { TideProvider, TideSample } from "../tides/types";

/**
 * Recent water-level series for the handful of stations near what's on air. One
 * doc per station, UPSERTED on `key` each snapshot (a re-poll refreshes samples
 * without duplicating). A TTL on `updatedAt` drops series that stopped being
 * refreshed (the focus moved elsewhere); a `2dsphere` index powers the public
 * "nearest cached gauge to this point" query.
 */
const TTL_SEC = Number(process.env.TIDE_SERIES_TTL_SEC || 6 * 60 * 60);

export interface iTideSeries extends iGeneralModel {
  /** `${provider}:${stationId}` — the upsert key. */
  key: string;
  stationId: string;
  provider: TideProvider;
  name: string;
  lng: number;
  lat: number;
  samples: TideSample[];
  latest: number;
  updatedAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iTideSeriesModel extends iTideSeries {
  id: string;
  _id: string;
}

const SampleSchema = new mongoose.Schema<TideSample>(
  { t: { type: Number, required: true }, v: { type: Number, required: true } },
  { _id: false },
);

const TideSeriesSchema = new mongoose.Schema<iTideSeriesModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    key: { type: String, required: true, unique: true },
    stationId: { type: String, required: true },
    provider: { type: String, required: true },
    name: { type: String, required: true },
    lng: { type: Number, required: true },
    lat: { type: Number, required: true },
    samples: { type: [SampleSchema], default: [] },
    latest: { type: Number, required: true },
    updatedAt: { type: Date, required: true, default: () => new Date() },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

TideSeriesSchema.index({ key: 1 }, { unique: true, name: "tide_series_key_ix" });
TideSeriesSchema.index({ loc: "2dsphere" }, { name: "tide_series_geo_ix", sparse: true });
// Roll off series the worker stopped refreshing once the focus moved away.
TideSeriesSchema.index({ updatedAt: 1 }, { name: "tide_series_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getTideSeriesModel = (conn: Connection) =>
  getModel<iTideSeriesModel>(conn, "TideSeries", TideSeriesSchema);
