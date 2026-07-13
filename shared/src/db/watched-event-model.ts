import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { WatchedEventType, WatchedEventStatus } from "../events/types";

/**
 * The unified cross-source event dossier. One doc per physical event, keyed by
 * its PRIMARY source observation `(primarySource, primarySourceId)` — a weather
 * alert's `(source, identifier)`, or later a quake's `(usgs, quakeId)`. Every
 * event TYPE lives here, so the timeline/media/series machinery is shared.
 *
 * Non-destructive by design: this sits OVER the existing alert/quake docs (which
 * keep their own collections) — the event carries only a lean framing summary
 * (repPoint + bbox); the full geometry stays on the source doc, reachable via
 * `(primarySource, primarySourceId)`. Promotion is an idempotent upsert on that
 * key (see watched-event-repo#promoteFromAlert). All time fields are ISO strings
 * (like the alert model) so the derived timeline sorts by `Date.parse`.
 */

/** The subset of a WatchedEvent that `alertToWatchedEvent` derives (pre-persistence). */
export interface WatchedEventCore {
  type: WatchedEventType;
  status: WatchedEventStatus;
  title: string;
  /** ISO onset (empty → repo fills ingest time on insert). */
  startedAt: string;
  endedAt?: string;
  /** Representative point for map badge + camera framing. */
  repPoint?: { type: "Point"; coordinates: [number, number] };
  /** [w,s,e,n] framing box. */
  bbox?: number[];
  primarySource: string;
  primarySourceId: string;
}

export interface iWatchedEvent extends iGeneralModel {
  type: WatchedEventType;
  status: WatchedEventStatus;
  title: string;
  startedAt: string;
  endedAt?: string;
  repPoint?: { type: "Point"; coordinates: [number, number] };
  bbox?: number[];
  primarySource: string;
  primarySourceId: string;
  /** ISO of the most recent source update observed for this event. */
  lastSourceUpdateAt?: string;
  /** ISO of the last acquisition sweep. */
  lastCheckedAt?: string;
  /** ISO after which the event is no longer actively watched. */
  watchUntil?: string;
}

export interface iWatchedEventModel extends iWatchedEvent {
  id: string;
  _id: string;
}

export const WatchedEventSchema = new mongoose.Schema<iWatchedEventModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    type: { type: String, required: true, default: "WEATHER_ALERT" },
    status: { type: String, required: true, default: "ACTIVE" },
    title: { type: String, required: true, default: "" },
    startedAt: { type: String, required: true, default: () => new Date().toISOString() },
    endedAt: { type: String, required: false },
    repPoint: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
    bbox: { type: [Number], required: false },
    primarySource: { type: String, required: true },
    primarySourceId: { type: String, required: true },
    lastSourceUpdateAt: { type: String, required: false },
    lastCheckedAt: { type: String, required: false },
    watchUntil: { type: String, required: false },
  },
  mongoTimestamps,
);

// Idempotency / promotion key — one event per primary source observation.
WatchedEventSchema.index({ primarySource: 1, primarySourceId: 1 }, { unique: true, name: "watched_event_primary_ix" });
// Active-watch sweep (list active events, framing lookups).
WatchedEventSchema.index({ status: 1, startedAt: -1 }, { name: "watched_event_status_ix" });
WatchedEventSchema.index({ type: 1, status: 1 }, { name: "watched_event_type_ix" });
WatchedEventSchema.index({ repPoint: "2dsphere" }, { name: "watched_event_geo_ix", sparse: true });

export const getWatchedEventModel = (conn: Connection) =>
  getModel<iWatchedEventModel>(conn, "WatchedEvent", WatchedEventSchema);
