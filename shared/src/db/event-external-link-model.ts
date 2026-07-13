import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { MatchMethod } from "../events/types";

/**
 * A recorded link between an event and an external source's own id, so we NEVER
 * re-fuzzy-match the same event. Once a ReliefWeb disaster / Copernicus activation
 * / EONET event is matched to a WatchedEvent, the link (and how confident the
 * match was) is stored; subsequent polls resolve by this link, not by guessing.
 */

export interface iEventExternalLink extends iGeneralModel {
  eventId: string;
  source: string;
  externalId: string;
  matchMethod: MatchMethod;
  matchScore?: number;
  linkedAt: string;
}

export interface iEventExternalLinkModel extends iEventExternalLink {
  id: string;
  _id: string;
}

export const EventExternalLinkSchema = new mongoose.Schema<iEventExternalLinkModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    eventId: { type: String, required: true },
    source: { type: String, required: true },
    externalId: { type: String, required: true },
    matchMethod: { type: String, required: true, default: "DERIVED" },
    matchScore: { type: Number, required: false },
    linkedAt: { type: String, required: true, default: () => new Date().toISOString() },
  },
  mongoTimestamps,
);

// One link per source per event, and one event per external id (no cross-linking).
EventExternalLinkSchema.index({ eventId: 1, source: 1 }, { unique: true, name: "event_link_event_ix" });
EventExternalLinkSchema.index({ source: 1, externalId: 1 }, { unique: true, name: "event_link_external_ix" });

export const getEventExternalLinkModel = (conn: Connection) =>
  getModel<iEventExternalLinkModel>(conn, "EventExternalLink", EventExternalLinkSchema);
