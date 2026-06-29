import mongoose, { Connection } from "mongoose";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Static aircraft metadata keyed by ICAO24 hex — registration (tail number),
 * type, operator. Sourced from hexdb.io (keyless) and cached forever (it rarely
 * changes), so we look up each airframe once and reuse it. The worker fills this
 * progressively; the aircraft route joins it onto the live snapshot.
 */
export interface iAircraftMeta extends iGeneralModel {
  /** ICAO24 hex (lowercase). Also the document id. */
  icao24: string;
  registration?: string;
  /** Full type name, e.g. "Boeing 737-800". */
  type?: string;
  /** ICAO type code, e.g. "B738". */
  typeCode?: string;
  manufacturer?: string;
  operator?: string;
  /** epoch ms of the last hexdb lookup (incl. misses, to throttle retries). */
  fetchedAt: number;
  /** hexdb had no record — cached so we don't re-hammer it. */
  notFound?: boolean;
}

export interface iAircraftMetaModel extends iAircraftMeta {
  id: string;
  _id: string;
}

const AircraftMetaSchema = new mongoose.Schema<iAircraftMetaModel>(
  {
    id: { type: String, required: true, unique: true },
    icao24: { type: String, required: true, index: true },
    registration: { type: String, required: false },
    type: { type: String, required: false },
    typeCode: { type: String, required: false },
    manufacturer: { type: String, required: false },
    operator: { type: String, required: false },
    fetchedAt: { type: Number, required: true, default: 0 },
    notFound: { type: Boolean, required: false },
  },
  { timestamps: false },
);

export const getAircraftMetaModel = (conn: Connection) =>
  getModel<iAircraftMetaModel>(conn, "AircraftMeta", AircraftMetaSchema);
