import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * The PERMANENT seismic record.
 *
 * `Quake` is the working set: it carries a TTL on `time` so it tracks the
 * rolling feed window, which is right for the live overlay and means every
 * earthquake older than ~31 days is deleted by Mongo with nothing keeping a
 * copy. Ask "what happened last year" and there was no answer at all
 * (docs/blob-retention-plan.md).
 *
 * This collection is that copy: significant events only (see
 * QUAKE_ARCHIVE_MIN_MAG), no TTL, no blobs, upserted on the USGS `quakeId` so a
 * re-run is idempotent and a revised magnitude lands on the archived row too.
 * Same relationship `WeatherFrame` has with `WeatherRun` — copy into a
 * collection retention never touches.
 */
export interface iQuakeArchive extends iGeneralModel {
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
  /** When this event was copied into the permanent record. */
  archivedAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iQuakeArchiveModel extends iQuakeArchive {
  id: string;
  _id: string;
}

const QuakeArchiveSchema = new mongoose.Schema<iQuakeArchiveModel>(
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
    archivedAt: { type: Date, required: true, default: () => new Date() },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

QuakeArchiveSchema.index({ quakeId: 1 }, { unique: true, name: "quake_arch_id_ix" });
QuakeArchiveSchema.index({ time: -1, mag: 1 }, { name: "quake_arch_time_mag_ix" });
QuakeArchiveSchema.index({ loc: "2dsphere" }, { name: "quake_arch_geo_ix", sparse: true });
// DELIBERATELY no TTL index. This collection is the record; if it expires, there
// is no record. Bound it by raising QUAKE_ARCHIVE_MIN_MAG, never by an expiry.

export const getQuakeArchiveModel = (conn: Connection) =>
  getModel<iQuakeArchiveModel>(conn, "QuakeArchive", QuakeArchiveSchema);
