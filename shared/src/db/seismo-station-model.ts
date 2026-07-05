import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Cached GSN broadband-station catalog (FDSN). Near-static reference data,
 * refreshed on a slow cron; the worker `replace`s the whole set each refresh.
 * A `2dsphere` index on `loc` powers "stations nearest this event" lookups
 * for both the SeedLink focus selection and the globe overlay/panel.
 */
export interface iSeismoStation extends iGeneralModel {
  /** `${net}.${sta}.${loc}.${cha}` — the upsert key (the one channel we stream). */
  key: string;
  net: string;
  sta: string;
  loc: string;
  cha: string;
  lat: number;
  lng: number;
  elevation?: number;
  siteName?: string;
  fetchedAt: Date;
  /** Geo point (named `geo`, not `loc` — that's already the SEED location code). */
  geo?: { type: "Point"; coordinates: [number, number] };
}

export interface iSeismoStationModel extends iSeismoStation {
  id: string;
  _id: string;
}

const SeismoStationSchema = new mongoose.Schema<iSeismoStationModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    key: { type: String, required: true, unique: true },
    net: { type: String, required: true },
    sta: { type: String, required: true },
    loc: { type: String, required: true },
    cha: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    elevation: { type: Number, required: false },
    siteName: { type: String, required: false },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
    geo: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

SeismoStationSchema.index({ key: 1 }, { unique: true, name: "seismo_station_key_ix" });
SeismoStationSchema.index({ geo: "2dsphere" }, { name: "seismo_station_geo_ix", sparse: true });

export const getSeismoStationModel = (conn: Connection) =>
  getModel<iSeismoStationModel>(conn, "SeismoStation", SeismoStationSchema);
