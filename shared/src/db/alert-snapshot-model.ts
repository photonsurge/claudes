import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * A captured image for an alert over time — a satellite frame over the warning
 * bbox, a nearby-camera still, or a side-by-side comparison. Append-style (a
 * SERIES per alert, not a singleton), deduped per hour via `slotKey` so the
 * hourly snapshot job yields one frame per hour per `(alertId, kind, layer)`.
 *
 * Bytes live on the shared `${BLOB_DIR}` folder (keyed by the doc `id`), NOT in
 * Mongo — the metadata doc is byte-free when FS-backed (`png` undefined). See
 * blob-fs.ts / inline-blob.ts; repo owns the byte I/O. Mirrors satimg's split.
 */

export type AlertSnapshotKind = "satellite" | "camera" | "compare";

export interface iAlertSnapshot extends iGeneralModel {
  source: string;
  identifier: string;
  alertId?: string;
  /** The unified WatchedEvent this alert was promoted to (back-filled by the bridge). */
  eventId?: string;
  kind: AlertSnapshotKind;
  /** Satellite layer ("geocolor" | "ir" …); undefined for camera/compare. */
  layer?: string;
  /**
   * Which SOURCE frames a derived image was built from, e.g. a compare's
   * `${earliestId}:${latestId}`. The compare job skips re-rendering a pair it
   * has already stored — without this it re-stored a byte-identical side-by-side
   * every hour, which is what filled `${BLOB_DIR}` (docs/blob-retention-plan.md).
   * Undefined for captured (non-derived) kinds.
   */
  pairKey?: string;
  /** Dedup key: `${alertId}:${kind}:${layer}:${hourSlot}`. */
  slotKey: string;
  /** The capture hour bucket, e.g. "2026-07-12T15". */
  hourSlot: string;
  /** [w,s,e,n] for a satellite frame. */
  bounds?: number[];
  width: number;
  height: number;
  observationTime: Date;
  capturedAt: Date;
  contentType: string;
  /** Perceptual hash (camera dedup, P2). */
  pHash?: string;
  camId?: string;
  distanceKm?: number;
  attribution?: string;
  /** Inline bytes — set only when FS storage is OFF; undefined when on disk. */
  png?: Buffer;
}

export interface iAlertSnapshotModel extends iAlertSnapshot {
  id: string;
  _id: string;
}

export const AlertSnapshotSchema = new mongoose.Schema<iAlertSnapshotModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    source: { type: String, required: true },
    identifier: { type: String, required: true },
    alertId: { type: String, required: false },
    eventId: { type: String, required: false },
    kind: { type: String, required: true, default: "satellite" },
    layer: { type: String, required: false },
    pairKey: { type: String, required: false },
    slotKey: { type: String, required: true },
    hourSlot: { type: String, required: true },
    bounds: { type: [Number], required: false },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    observationTime: { type: Date, required: true },
    capturedAt: { type: Date, required: true, default: () => new Date() },
    contentType: { type: String, required: true, default: "image/png" },
    pHash: { type: String, required: false },
    camId: { type: String, required: false },
    distanceKm: { type: Number, required: false },
    attribution: { type: String, required: false },
    png: { type: Buffer, required: false },
  },
  mongoTimestamps,
);

AlertSnapshotSchema.index({ slotKey: 1 }, { unique: true, name: "alert_snap_slot_ix" });
AlertSnapshotSchema.index({ source: 1, identifier: 1, capturedAt: -1 }, { name: "alert_snap_alert_ix" });
AlertSnapshotSchema.index({ alertId: 1, kind: 1, capturedAt: -1 }, { name: "alert_snap_alertid_ix" });
AlertSnapshotSchema.index({ eventId: 1, kind: 1, capturedAt: -1 }, { name: "alert_snap_event_ix", sparse: true });

export const getAlertSnapshotModel = (conn: Connection) =>
  getModel<iAlertSnapshotModel>(conn, "AlertSnapshot", AlertSnapshotSchema);
