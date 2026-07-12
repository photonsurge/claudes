import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { AlertMsgType, AlertStatus, SeverityRank } from "./alert-model";
import type { AlertChange } from "../alerts/diff";

/**
 * One append-only revision of an alert. WMO/GDACS re-poll the same
 * `(source, identifier)` and OVERWRITE the alert doc in place (no CAP
 * `references` chain), so this collection is where an alert's history lives.
 * `ingestSource` appends a row only when `diffAlert` finds a meaningful change,
 * so a steady-state re-poll writes nothing. Mirrors the append-only AirEntry
 * shape (a `seq` per key + immutable rows). The timeline is DERIVED from these
 * (timeline.ts#buildTimeline) — not stored.
 */

export interface iAlertRevision extends iGeneralModel {
  /** Alert dedup key. */
  source: string;
  identifier: string;
  /** The Alert doc's stable uuid (`id`), for reverse lookup. */
  alertId: string;
  /** 1-based revision number within `(source, identifier)`. */
  seq: number;
  /** When this version was observed — the alert's `sent`, or ingest time. */
  at: string;
  msgType: AlertMsgType;
  status: AlertStatus;
  /** The detected changes vs the previous version (see diffAlert). */
  changes: AlertChange[];
  // Denormalised snapshot so the timeline/graph never re-reads the Alert doc.
  severityRank: SeverityRank;
  areaKm2: number;
  expiresAt?: string;
  onset?: string;
}

export interface iAlertRevisionModel extends iAlertRevision {
  id: string;
  _id: string;
}

const AlertChangeSchema = new mongoose.Schema<AlertChange>(
  {
    type: { type: String, required: true },
    from: { type: String, required: false },
    to: { type: String, required: false },
  },
  { _id: false },
);

export const AlertRevisionSchema = new mongoose.Schema<iAlertRevisionModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    source: { type: String, required: true },
    identifier: { type: String, required: true },
    alertId: { type: String, required: true },
    seq: { type: Number, required: true },
    at: { type: String, required: true },
    msgType: { type: String, required: true, default: "Alert" },
    status: { type: String, required: true, default: "Actual" },
    changes: { type: [AlertChangeSchema], default: [] },
    severityRank: { type: Number, required: true, min: 0, max: 4, default: 0 },
    areaKm2: { type: Number, required: true, default: 0 },
    expiresAt: { type: String, required: false },
    onset: { type: String, required: false },
  },
  mongoTimestamps,
);

// Ordered timeline read for one alert.
AlertRevisionSchema.index({ source: 1, identifier: 1, seq: 1 }, { name: "alert_rev_key_ix" });
// Reverse lookup by the Alert doc id.
AlertRevisionSchema.index({ alertId: 1, seq: 1 }, { name: "alert_rev_alertid_ix" });

export const getAlertRevisionModel = (conn: Connection) =>
  getModel<iAlertRevisionModel>(conn, "AlertRevision", AlertRevisionSchema);
