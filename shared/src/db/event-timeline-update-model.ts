import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { EventTimelineUpdateType } from "../events/types";

/**
 * A STORED timeline beat for a WatchedEvent. Unlike the alert timeline (which is
 * derived on read from a single alert's revisions), a unified event's timeline
 * has MANY contributors — source diffs, satellite captures, resource additions,
 * situation reports — that cannot be reconstructed from any one source. So the
 * beats are stored: the promotion bridge converts the `AlertChange[]` it already
 * computed into rows, and every acquisition adapter appends its own. The read
 * builder (events/event-timeline.ts) only synthesises the head/tail.
 *
 * Idempotency is by the natural key `(eventId, type, at, source, refUrl)` at the
 * repo layer (a re-poll of the same report/product doesn't duplicate a beat).
 */

export interface iEventTimelineUpdate extends iGeneralModel {
  eventId: string;
  /** ISO instant of the beat. */
  at: string;
  type: EventTimelineUpdateType;
  /** Human, presentation-ready label. */
  label: string;
  summary?: string;
  /** Contributing source (wmo/gdacs/reliefweb/copernicus/eonet/usgs…). */
  source?: string;
  severityRank?: number;
  areaKm2?: number;
  /** Canonical reference (report/product url) — also part of the dedup key. */
  refUrl?: string;
  /** Content hash of the contributing payload (for reference). */
  payloadHash?: string;
  /** Arbitrary structured extras (impact figures, counts…). */
  data?: Record<string, unknown>;
  /** Linked event_snapshots ids for media beats. */
  assetIds?: string[];
}

export interface iEventTimelineUpdateModel extends iEventTimelineUpdate {
  id: string;
  _id: string;
}

/** A beat to append — `id` is assigned by the repo. */
export type NewEventTimelineUpdate = Omit<iEventTimelineUpdate, "id" | "created" | "updated">;

export const EventTimelineUpdateSchema = new mongoose.Schema<iEventTimelineUpdateModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    eventId: { type: String, required: true },
    at: { type: String, required: true },
    type: { type: String, required: true },
    label: { type: String, required: true, default: "" },
    summary: { type: String, required: false },
    source: { type: String, required: false },
    severityRank: { type: Number, required: false },
    areaKm2: { type: Number, required: false },
    refUrl: { type: String, required: false },
    payloadHash: { type: String, required: false },
    data: { type: mongoose.Schema.Types.Mixed, required: false },
    assetIds: { type: [String], required: false },
  },
  mongoTimestamps,
);

// Ordered timeline read for one event.
EventTimelineUpdateSchema.index({ eventId: 1, at: 1 }, { name: "event_tl_event_ix" });

export const getEventTimelineUpdateModel = (conn: Connection) =>
  getModel<iEventTimelineUpdateModel>(conn, "EventTimelineUpdate", EventTimelineUpdateSchema);
