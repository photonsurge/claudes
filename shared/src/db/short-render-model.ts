import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { ShortRender, ShortRenderQueueState } from "../short-render";

/**
 * The render queue (docs/short-video-plan.md §6.6): one doc per video, keyed by
 * `id`, plus one tiny doc per encoder for its pause switch. `what`, `video` and
 * `roundup` are Mixed: they are request blobs the worker reads whole (and
 * `sanitizeRenderRequest` validated on the way in).
 */
export interface iShortRenderModel extends iGeneralModel, ShortRender {
  id: string;
  _id: string;
}

export interface iShortRenderQueueModel extends iGeneralModel, ShortRenderQueueState {
  _id: string;
}

const STATUSES = ["queued", "preparing", "live", "done", "skipped", "failed", "cancelled"];

const ShortRenderSchema = new mongoose.Schema<iShortRenderModel>(
  {
    id: { type: String, required: true, unique: true },
    encoderId: { type: String, required: true },
    what: { type: mongoose.Schema.Types.Mixed, required: true },
    publishAs: { type: String, required: true, enum: ["public", "unlisted", "private"], default: "unlisted" },
    offline: { type: Boolean, required: true, default: false },
    accountId: { type: String },
    video: { type: mongoose.Schema.Types.Mixed, default: undefined },
    roundup: { type: mongoose.Schema.Types.Mixed, default: undefined },
    skipIfQuiet: { type: Boolean },
    scheduleId: { type: String },
    batchId: { type: String },
    status: { type: String, required: true, enum: STATUSES, default: "queued" },
    startBy: { type: Number },
    notBefore: { type: Number },
    queuedAt: { type: Number, required: true },
    startedAt: { type: Number },
    endedAt: { type: Number },
    scriptId: { type: String },
    runId: { type: String },
    videoUrl: { type: String },
    note: { type: String },
    assignedEncoderId: { type: String },
    retryOf: { type: String },
    formatId: { type: String, index: true },
  },
  mongoTimestamps,
);

ShortRenderSchema.index({ status: 1, queuedAt: 1 }, { name: "short_render_status_ix" });
ShortRenderSchema.index({ runId: 1 }, { name: "short_render_run_ix", sparse: true });
ShortRenderSchema.index({ queuedAt: -1 }, { name: "short_render_recent_ix" });

const ShortRenderQueueSchema = new mongoose.Schema<iShortRenderQueueModel>(
  {
    encoderId: { type: String, required: true, unique: true },
    paused: { type: Boolean, required: true, default: false },
  },
  mongoTimestamps,
);

export const getShortRenderModel = (conn: Connection) =>
  getModel<iShortRenderModel>(conn, "ShortRender", ShortRenderSchema);
export const getShortRenderQueueModel = (conn: Connection) =>
  getModel<iShortRenderQueueModel>(conn, "ShortRenderQueue", ShortRenderQueueSchema);
