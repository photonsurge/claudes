import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * One contributor's LATEST normalized observation for an event. An event gathers
 * many source records (WMO alert, GDACS event, ReliefWeb disaster, Copernicus
 * activation, EONET event) that stay independent — this is the current snapshot
 * per `(eventId, source)`; the append-only history lives in event_source_revisions.
 * Never overwrite history — this doc only ever holds the newest normalized state.
 */

export interface iEventSource extends iGeneralModel {
  eventId: string;
  source: string;
  /** The source's own id for this event (GDACS eventid, ReliefWeb disaster id…). */
  sourceEventId: string;
  sourceUrl?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastChangedAt?: string;
  currentPayloadHash: string;
  normalized: Record<string, unknown>;
}

export interface iEventSourceModel extends iEventSource {
  id: string;
  _id: string;
}

export const EventSourceSchema = new mongoose.Schema<iEventSourceModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    eventId: { type: String, required: true },
    source: { type: String, required: true },
    sourceEventId: { type: String, required: true, default: "" },
    sourceUrl: { type: String, required: false },
    firstSeenAt: { type: String, required: true, default: () => new Date().toISOString() },
    lastSeenAt: { type: String, required: true, default: () => new Date().toISOString() },
    lastChangedAt: { type: String, required: false },
    currentPayloadHash: { type: String, required: true, default: "" },
    normalized: { type: mongoose.Schema.Types.Mixed, required: false, default: {} },
  },
  mongoTimestamps,
);

EventSourceSchema.index({ eventId: 1, source: 1 }, { unique: true, name: "event_source_key_ix" });
EventSourceSchema.index({ source: 1, sourceEventId: 1 }, { name: "event_source_external_ix" });

export const getEventSourceModel = (conn: Connection) =>
  getModel<iEventSourceModel>(conn, "EventSource", EventSourceSchema);
