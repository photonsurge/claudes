import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { SeismoSample } from "../seismo/types";

/**
 * Recent live waveform for the handful of stations near what's on air. One
 * doc per channel, UPSERTED on `key` as new SeedLink records arrive (samples
 * trimmed to a rolling window, not appended forever). A TTL on `updatedAt`
 * drops series the loop stopped streaming (the focus moved elsewhere); the
 * `2dsphere` index powers the public "stations near this point" query — the
 * panel/overlay can show several at once, not just the single nearest.
 */
const TTL_SEC = Number(process.env.SEISMO_SERIES_TTL_SEC || 30 * 60);

export interface iSeismoSeries extends iGeneralModel {
  /** `${net}.${sta}.${loc}.${cha}` — the upsert key. */
  key: string;
  net: string;
  sta: string;
  loc: string;
  cha: string;
  lat: number;
  lng: number;
  siteName?: string;
  sampleRateHz: number;
  samples: SeismoSample[];
  latest: number;
  updatedAt: Date;
  geo?: { type: "Point"; coordinates: [number, number] };
}

export interface iSeismoSeriesModel extends iSeismoSeries {
  id: string;
  _id: string;
}

const SampleSchema = new mongoose.Schema<SeismoSample>(
  { t: { type: Number, required: true }, v: { type: Number, required: true } },
  { _id: false },
);

const SeismoSeriesSchema = new mongoose.Schema<iSeismoSeriesModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    key: { type: String, required: true, unique: true },
    net: { type: String, required: true },
    sta: { type: String, required: true },
    loc: { type: String, required: true },
    cha: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    siteName: { type: String, required: false },
    sampleRateHz: { type: Number, required: true },
    samples: { type: [SampleSchema], default: [] },
    latest: { type: Number, required: true },
    updatedAt: { type: Date, required: true, default: () => new Date() },
    geo: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

SeismoSeriesSchema.index({ key: 1 }, { unique: true, name: "seismo_series_key_ix" });
SeismoSeriesSchema.index({ geo: "2dsphere" }, { name: "seismo_series_geo_ix", sparse: true });
SeismoSeriesSchema.index({ updatedAt: 1 }, { name: "seismo_series_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getSeismoSeriesModel = (conn: Connection) =>
  getModel<iSeismoSeriesModel>(conn, "SeismoSeries", SeismoSeriesSchema);
