import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Cached tectonic plate boundaries (Bird 2003 PB2002). Near-static reference
 * geography: the worker upserts on the deterministic `faultId` slug on a slow
 * cron and the public app only ever reads the cache. No TTL — boundaries don't
 * roll out of a window like quakes; a re-snapshot refreshes geometry in place.
 *
 * `paths` is an array of polylines (a MultiLineString boundary has several),
 * each a list of [lng,lat] pairs — stored as Mixed since the shape is fixed by
 * the source, not queried on.
 */
export interface iFault extends iGeneralModel {
  /** Deterministic plate-pair slug ("AF-AN-3") — the upsert key. */
  faultId: string;
  name: string;
  type?: string;
  paths: [number, number][][];
  fetchedAt: Date;
}

export interface iFaultModel extends iFault {
  id: string;
  _id: string;
}

const FaultSchema = new mongoose.Schema<iFaultModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    faultId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    type: { type: String, required: false },
    paths: { type: mongoose.Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

FaultSchema.index({ faultId: 1 }, { unique: true, name: "fault_id_ix" });

export const getFaultModel = (conn: Connection) =>
  getModel<iFaultModel>(conn, "Fault", FaultSchema);
