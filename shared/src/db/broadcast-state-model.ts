import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { ControlState } from "../control";

/** The id of the single broadcast-state document (single-domain → one row). */
export const BROADCAST_STATE_ID = "default" as const;

/** Persisted operator state. Mirrors ControlState plus the base entity fields. */
export interface iBroadcastState extends iGeneralModel, ControlState {}

export interface iBroadcastStateModel extends iBroadcastState {
  id: string;
  _id: string;
}

const BroadcastStateSchema = new mongoose.Schema<iBroadcastStateModel>(
  {
    id: { type: String, required: true, unique: true, default: BROADCAST_STATE_ID },
    activeVariable: { type: String, required: false, default: "temp" },
    fhr: { type: Number, required: true, default: 0 },
    basemap: { type: String, required: true, default: "dark" },
    showWind: { type: Boolean, required: true, default: true },
    showPressure: { type: Boolean, required: true, default: false },
    showCities: { type: Boolean, required: true, default: true },
    camera: {
      center: { type: [Number], required: true, default: [0, 20] },
      zoom: { type: Number, required: true, default: 1.4 },
    },
    units: {
      wind: { type: String, required: true, enum: ["kt", "m/s"], default: "kt" },
      temp: { type: String, required: true, enum: ["C", "F"], default: "C" },
    },
  },
  mongoTimestamps,
);

export const getBroadcastStateModel = (conn: Connection) =>
  getModel<iBroadcastStateModel>(conn, "BroadcastState", BroadcastStateSchema);
