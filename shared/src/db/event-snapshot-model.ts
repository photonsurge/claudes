import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * A captured image for a WatchedEvent over time — a satellite frame over the
 * event bbox, a nearby-camera still, a side-by-side comparison, or a rendered
 * preview of an official map/product. Append-style (a SERIES per event), deduped
 * per hour via `slotKey`. Bytes live on the shared `${BLOB_DIR}` folder (keyed by
 * the doc `id`), NOT in Mongo — the metadata doc is byte-free when FS-backed.
 * Generic clone of alert-snapshot (event-keyed).
 */

export type EventSnapshotKind = "satellite" | "camera" | "compare" | "map" | "render";

export interface iEventSnapshot extends iGeneralModel {
  eventId: string;
  source: string;
  kind: EventSnapshotKind;
  /** Satellite layer / product code; undefined for camera/compare. */
  layer?: string;
  /** Dedup key: `${eventId}:${kind}:${layer}:${hourSlot}`. */
  slotKey: string;
  hourSlot: string;
  /** [w,s,e,n] for a satellite/map frame. */
  bounds?: number[];
  width: number;
  height: number;
  observationTime: Date;
  capturedAt: Date;
  contentType: string;
  pHash?: string;
  /** Mean brightness 0-255 (camera frames) — lets day/night be told apart for
   *  timelapse spanning + day+night retention thinning. */
  meanLuma?: number;
  camId?: string;
  distanceKm?: number;
  attribution?: string;
  /** Inline bytes — set only when FS storage is OFF; undefined when on disk. */
  png?: Buffer;
}

export interface iEventSnapshotModel extends iEventSnapshot {
  id: string;
  _id: string;
}

export const EventSnapshotSchema = new mongoose.Schema<iEventSnapshotModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    eventId: { type: String, required: true },
    source: { type: String, required: true, default: "" },
    kind: { type: String, required: true, default: "satellite" },
    layer: { type: String, required: false },
    slotKey: { type: String, required: true },
    hourSlot: { type: String, required: true },
    bounds: { type: [Number], required: false },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    observationTime: { type: Date, required: true },
    capturedAt: { type: Date, required: true, default: () => new Date() },
    contentType: { type: String, required: true, default: "image/png" },
    pHash: { type: String, required: false },
    meanLuma: { type: Number, required: false },
    camId: { type: String, required: false },
    distanceKm: { type: Number, required: false },
    attribution: { type: String, required: false },
    png: { type: Buffer, required: false },
  },
  mongoTimestamps,
);

EventSnapshotSchema.index({ slotKey: 1 }, { unique: true, name: "event_snap_slot_ix" });
EventSnapshotSchema.index({ eventId: 1, kind: 1, capturedAt: -1 }, { name: "event_snap_event_ix" });

export const getEventSnapshotModel = (conn: Connection) =>
  getModel<iEventSnapshotModel>(conn, "EventSnapshot", EventSnapshotSchema);
