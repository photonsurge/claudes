import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { SegmentKind } from "../director";

/**
 * The broadcast "as-run" log: what the auto-director actually put on air, for
 * after-the-fact review on /admin/runs.
 *
 * An AirRun is one continuous auto-director session for one scene — it opens
 * when the scene enters auto mode and closes when it leaves (or when a fresh
 * session finds it dangling after a worker restart). An AirEntry is one cut
 * within a run: which segment kind aired, which subject it pointed at (the
 * quake / alert / country / globe view), how long it was planned to hold vs.
 * how long it really held, and the sub-views (round-up tour stops) the shot
 * carried. The worker's director loop is the single writer.
 */

/** Why a run stopped: the operator turned auto off, or a restart orphaned it. */
export type AirRunEndReason = "auto-off" | "stale";
/** Why an entry left the screen: hold expired, operator skipped, or run ended. */
export type AirEntryEndReason = "expired" | "skipped" | "run-ended";

export interface iAirRun extends iGeneralModel {
  sceneId: string;
  startedAt: Date;
  /** Unset while the session is (believed) live. */
  endedAt?: Date;
  endReason?: AirRunEndReason;
  /** Total cuts recorded so far. */
  cuts: number;
  /** Airing tally per segment kind, e.g. { quake: 4, country: 2 }. */
  kindCounts: Record<string, number>;
  lastCutAt?: Date;
}

/** One planned sub-view within an entry (a round-up tour stop). */
export interface iAirEntryStop {
  label: string;
  subtitle?: string;
  lng: number;
  lat: number;
}

export interface iAirEntry extends iGeneralModel {
  runId: string;
  sceneId: string;
  /** The director's cut counter — 1-based, ordered within the run. */
  seq: number;
  kind: SegmentKind;
  /** Stable subject id, e.g. "quake:us7000abcd" or "country:jp". */
  segmentId: string;
  title: string;
  subtitle?: string;
  icon?: string;
  /** Cut was picked by the breaking-news priority tier, not fair rotation. */
  breaking: boolean;
  /** Nth airing of this exact segment in the session (1 = first time). */
  timesShown: number;
  /** Camera frame: [lng, lat] + zoom (the globe view for global kinds). */
  center: [number, number];
  zoom: number;
  /** Planned hold. */
  holdMs: number;
  startedAt: Date;
  /** Set when the next cut (or the run's end) pushes this one off air. */
  endedAt?: Date;
  /** Real time on screen, ms — shorter than holdMs when skipped. */
  actualMs?: number;
  endReason?: AirEntryEndReason;
  /** For `ad` entries: which advertisement aired. */
  adId?: string;
  /** Sub-views the shot tours through (round-up stops), in order. */
  stops?: iAirEntryStop[];
  /** The operator info-box rows as aired (severity, depth, …). */
  details?: { label: string; value: string }[];
}

export interface iAirRunModel extends iAirRun {
  id: string;
  _id: string;
}

export interface iAirEntryModel extends iAirEntry {
  id: string;
  _id: string;
}

const AirRunSchema = new mongoose.Schema<iAirRunModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    sceneId: { type: String, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: false },
    endReason: { type: String, required: false, enum: ["auto-off", "stale"] },
    cuts: { type: Number, required: true, default: 0 },
    kindCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastCutAt: { type: Date, required: false },
  },
  mongoTimestamps,
);

// Newest-first list + "open runs for this scene" on session start.
AirRunSchema.index({ sceneId: 1, startedAt: -1 }, { name: "airrun_scene_ix" });
AirRunSchema.index({ startedAt: -1 }, { name: "airrun_started_ix" });

const AirEntryStopSchema = new mongoose.Schema<iAirEntryStop>(
  {
    label: { type: String, required: true, default: "" },
    subtitle: { type: String, required: false },
    lng: { type: Number, required: true },
    lat: { type: Number, required: true },
  },
  { _id: false },
);

const AirEntrySchema = new mongoose.Schema<iAirEntryModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    runId: { type: String, required: true },
    sceneId: { type: String, required: true },
    seq: { type: Number, required: true },
    kind: { type: String, required: true },
    segmentId: { type: String, required: true },
    title: { type: String, required: true, default: "" },
    subtitle: { type: String, required: false },
    icon: { type: String, required: false },
    breaking: { type: Boolean, required: true, default: false },
    timesShown: { type: Number, required: true, default: 1 },
    center: { type: [Number], required: true },
    zoom: { type: Number, required: true },
    holdMs: { type: Number, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: false },
    actualMs: { type: Number, required: false },
    endReason: { type: String, required: false, enum: ["expired", "skipped", "run-ended"] },
    adId: { type: String, required: false },
    stops: { type: [AirEntryStopSchema], required: false, default: undefined },
    details: { type: mongoose.Schema.Types.Mixed, required: false },
  },
  mongoTimestamps,
);

// Timeline read (ordered within a run) + open-entry close on the next cut.
AirEntrySchema.index({ runId: 1, seq: 1 }, { name: "airentry_run_ix" });
AirEntrySchema.index({ sceneId: 1, startedAt: -1 }, { name: "airentry_scene_ix" });

export const getAirRunModel = (conn: Connection) => getModel<iAirRunModel>(conn, "AirRun", AirRunSchema);
export const getAirEntryModel = (conn: Connection) => getModel<iAirEntryModel>(conn, "AirEntry", AirEntrySchema);
