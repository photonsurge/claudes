import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Position-history snapshots for OBSERVED tracks (aircraft/ships). Satellites are
 * deliberately excluded — their positions are deterministic from stored TLEs, so
 * history is reconstructed by propagation, not stored. Every snapshot from one
 * worker run shares a `batchAt` (the replay "frame"). A TTL index expires old
 * history so the collection stays bounded.
 */
export type TrackSnapshotKind = "aircraft" | "ship";

/**
 * History retention (TTL). Default 6h — at global coverage every frame is tens
 * of thousands of rows, so a multi-day default would balloon the collection; the
 * live overlay only needs the newest frame anyway. Raise TRACK_HISTORY_TTL_SEC
 * if you scope coverage down and want deeper replay.
 */
const TTL_SEC = Number(process.env.TRACK_HISTORY_TTL_SEC || 6 * 60 * 60);

export interface iTrackSnapshot extends iGeneralModel {
  kind: TrackSnapshotKind;
  /** icao24 (aircraft) or mmsi (ship). */
  externalId: string;
  name?: string;
  lng: number;
  lat: number;
  altM?: number;
  headingDeg?: number;
  /** m/s for aircraft, knots for ships (kind-relative). */
  speed?: number;
  region?: string;
  /** Shared by all snapshots in one job run — the replay frame timestamp. */
  batchAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iTrackSnapshotModel extends iTrackSnapshot {
  id: string;
  _id: string;
}

const TrackSnapshotSchema = new mongoose.Schema<iTrackSnapshotModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    kind: { type: String, required: true, enum: ["aircraft", "ship"] },
    externalId: { type: String, required: true },
    name: { type: String, required: false },
    lng: { type: Number, required: true },
    lat: { type: Number, required: true },
    altM: { type: Number, required: false },
    headingDeg: { type: Number, required: false },
    speed: { type: Number, required: false },
    region: { type: String, required: false },
    batchAt: { type: Date, required: true },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

// Replay: pick frames (batchAt) in a time window, then all rows of a frame.
TrackSnapshotSchema.index({ kind: 1, batchAt: 1 }, { name: "snap_kind_batch_ix" });
TrackSnapshotSchema.index({ loc: "2dsphere" }, { name: "snap_geo_ix", sparse: true });
// Auto-expire old history.
TrackSnapshotSchema.index({ batchAt: 1 }, { name: "snap_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getTrackSnapshotModel = (conn: Connection) =>
  getModel<iTrackSnapshotModel>(conn, "TrackSnapshot", TrackSnapshotSchema);
