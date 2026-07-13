import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Append-only revision history for one contributor to an event. Every time a
 * source payload CHANGES (hash moves) a revision is written, so the raw evolution
 * of each source is retained forever (the timeline is the human-readable view;
 * this is the audit trail). `seq` is 1-based per `(eventId, source)`. Mirrors the
 * alert-revision append-only shape.
 */

export interface EventSourceDiff {
  changedFields: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface iEventSourceRevision extends iGeneralModel {
  eventId: string;
  source: string;
  seq: number;
  /** The source's own timestamp for this version, when exposed. */
  sourceTimestamp?: string;
  acquiredAt: string;
  payloadHash: string;
  /** Optional pointer to the raw payload in blob/object storage. */
  rawPayloadRef?: string;
  normalized: Record<string, unknown>;
  diff?: EventSourceDiff;
}

export interface iEventSourceRevisionModel extends iEventSourceRevision {
  id: string;
  _id: string;
}

const DiffSchema = new mongoose.Schema<EventSourceDiff>(
  {
    changedFields: { type: [String], default: [] },
    before: { type: mongoose.Schema.Types.Mixed, required: false },
    after: { type: mongoose.Schema.Types.Mixed, required: false },
  },
  { _id: false },
);

export const EventSourceRevisionSchema = new mongoose.Schema<iEventSourceRevisionModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    eventId: { type: String, required: true },
    source: { type: String, required: true },
    seq: { type: Number, required: true },
    sourceTimestamp: { type: String, required: false },
    acquiredAt: { type: String, required: true },
    payloadHash: { type: String, required: true },
    rawPayloadRef: { type: String, required: false },
    normalized: { type: mongoose.Schema.Types.Mixed, required: false, default: {} },
    diff: { type: DiffSchema, required: false },
  },
  mongoTimestamps,
);

EventSourceRevisionSchema.index({ eventId: 1, source: 1, seq: 1 }, { name: "event_src_rev_key_ix" });

export const getEventSourceRevisionModel = (conn: Connection) =>
  getModel<iEventSourceRevisionModel>(conn, "EventSourceRevision", EventSourceRevisionSchema);
