import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Cached submarine fiber-optic cables (TeleGeography). Near-static reference
 * data: the worker upserts on the stable `cableId` slug on a slow cron and the
 * public app only ever reads the cache. No TTL — cables don't roll out of a
 * window like quakes; a re-snapshot refreshes geometry in place.
 *
 * `paths` is an array of polylines (a cable can land in several stretches), each
 * a list of [lng,lat] pairs — stored as Mixed since the shape is fixed by the
 * source, not queried on.
 */
export interface iCable extends iGeneralModel {
  /** TeleGeography slug — the upsert key. */
  cableId: string;
  name: string;
  color?: string;
  paths: [number, number][][];
  fetchedAt: Date;
}

export interface iCableModel extends iCable {
  id: string;
  _id: string;
}

const CableSchema = new mongoose.Schema<iCableModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    cableId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    color: { type: String, required: false },
    paths: { type: mongoose.Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

CableSchema.index({ cableId: 1 }, { unique: true, name: "cable_id_ix" });

export const getCableModel = (conn: Connection) =>
  getModel<iCableModel>(conn, "Cable", CableSchema);
