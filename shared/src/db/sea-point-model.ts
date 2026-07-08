import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Ocean-monitoring-point catalog — named places the `ocean` Director kind can
 * hold a shot on (currents/features, plus real monitoring regions like the
 * Niño boxes/Atlantic MDR/North Sea/Med/Indian Ocean Dipole). DB-backed (not a
 * static TS array) so the operator can add/retire regions from `/admin/sea-points`
 * without a code change. `enabled` gates whether the worker offers it as a
 * candidate at all; `depthCycle` marks the monitoring-region shots that flip
 * through the sea-temp-at-depth chapters instead of holding one fixed depth.
 */
export interface iSeaPoint extends iGeneralModel {
  /** Stable slug — the upsert key and the segment subject (`ocean:<pointId>`). */
  pointId: string;
  name: string;
  /** One-line description shown in the on-air subtitle. */
  blurb: string;
  lat: number;
  lng: number;
  /** Zoom that frames the feature as a regional (not global) shot. */
  zoom: number;
  /** Cycles through sst → sst100 → sst500 → sst2000 → sst5000 instead of a
   *  fixed surface reading — the editorial point IS the thermocline. */
  depthCycle: boolean;
  /** Off points are skipped by the Director without being deleted. */
  enabled: boolean;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iSeaPointModel extends iSeaPoint {
  id: string;
  _id: string;
}

const SeaPointSchema = new mongoose.Schema<iSeaPointModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    pointId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    blurb: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    zoom: { type: Number, required: true },
    depthCycle: { type: Boolean, required: true, default: false },
    enabled: { type: Boolean, required: true, default: true },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

SeaPointSchema.index({ pointId: 1 }, { unique: true, name: "sea_point_id_ix" });
SeaPointSchema.index({ loc: "2dsphere" }, { name: "sea_point_geo_ix", sparse: true });

export const getSeaPointModel = (conn: Connection) =>
  getModel<iSeaPointModel>(conn, "SeaPoint", SeaPointSchema);
