import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { SatelliteMeta } from "../tracks/types";

/**
 * Stored NORAD TLEs (orbital elements). Slowly changing, so the worker ingests
 * them from Celestrak on a schedule and the app propagates positions off the DB
 * copy instead of hammering Celestrak. One doc per object; `groups` records which
 * Celestrak feeds it appeared in (an object can be in several).
 */
export interface iSatelliteTle extends iGeneralModel {
  noradId: string;
  name: string;
  line1: string;
  line2: string;
  groups: string[];
  /** ISO of the last fetch that refreshed this element set. */
  fetchedAt: string;
  /** SATCAT descriptive metadata, joined by noradId (absent until enriched). */
  meta?: SatelliteMeta;
}

export interface iSatelliteTleModel extends iSatelliteTle {
  id: string;
  _id: string;
}

const SatelliteTleSchema = new mongoose.Schema<iSatelliteTleModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    noradId: { type: String, required: true, unique: true },
    name: { type: String, required: true, default: "" },
    line1: { type: String, required: true },
    line2: { type: String, required: true },
    groups: { type: [String], default: [] },
    fetchedAt: { type: String, required: true, default: () => new Date().toISOString() },
    // Loosely typed: enrichment is best-effort and the shape is owned by
    // SatelliteMeta / satcatToMeta, not re-declared field-by-field here.
    meta: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  mongoTimestamps,
);

SatelliteTleSchema.index({ noradId: 1 }, { unique: true, name: "sat_tle_norad_ix" });
SatelliteTleSchema.index({ groups: 1 }, { name: "sat_tle_groups_ix" });

export const getSatelliteTleModel = (conn: Connection) =>
  getModel<iSatelliteTleModel>(conn, "SatelliteTle", SatelliteTleSchema);
