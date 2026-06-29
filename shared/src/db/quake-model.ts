import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Cached USGS earthquakes. Unlike aircraft/ship snapshots there's no per-run
 * "frame": quakes are discrete events with a stable USGS id, so the worker
 * UPSERTS on `quakeId` (re-polling a feed refreshes magnitudes/depths as USGS
 * revises them, never duplicating). A TTL on `time` expires old events so the
 * collection tracks the rolling feed window rather than growing forever.
 */
const TTL_SEC = Number(process.env.QUAKE_TTL_SEC || 31 * 24 * 60 * 60);

export interface iQuake extends iGeneralModel {
  /** USGS event id (the upsert key). */
  quakeId: string;
  mag: number;
  place?: string;
  /** Event time. */
  time: Date;
  lng: number;
  lat: number;
  depthKm: number;
  url?: string;
  tsunami?: boolean;
  /** When the worker last refreshed this event from the feed. */
  fetchedAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iQuakeModel extends iQuake {
  id: string;
  _id: string;
}

const QuakeSchema = new mongoose.Schema<iQuakeModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    quakeId: { type: String, required: true, unique: true },
    mag: { type: Number, required: true },
    place: { type: String, required: false },
    time: { type: Date, required: true },
    lng: { type: Number, required: true },
    lat: { type: Number, required: true },
    depthKm: { type: Number, required: true },
    url: { type: String, required: false },
    tsunami: { type: Boolean, required: false },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

QuakeSchema.index({ quakeId: 1 }, { unique: true, name: "quake_id_ix" });
// Overlay reads newest-first, filtered by magnitude.
QuakeSchema.index({ time: -1, mag: 1 }, { name: "quake_time_mag_ix" });
QuakeSchema.index({ loc: "2dsphere" }, { name: "quake_geo_ix", sparse: true });
// Auto-expire events that have rolled out of the feed window.
QuakeSchema.index({ time: 1 }, { name: "quake_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getQuakeModel = (conn: Connection) =>
  getModel<iQuakeModel>(conn, "Quake", QuakeSchema);
