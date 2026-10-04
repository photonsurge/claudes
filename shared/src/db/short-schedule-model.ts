import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { ShortSchedule } from "../short-schedule";

/**
 * Scheduled video batches (docs/short-video-plan.md §8), one doc per schedule,
 * keyed by `id`. `when`, `videos` and `lastFire` are Mixed: they are blobs the
 * worker and the API read whole, validated by `sanitizeShortSchedule` on the
 * way in and again on the way out. `videos.formatId` is indexed for the
 * format delete guard; `enabled` + `nextAt` for the ticker.
 */
export interface iShortScheduleModel extends iGeneralModel, ShortSchedule {
  id: string;
  _id: string;
}

const ShortScheduleSchema = new mongoose.Schema<iShortScheduleModel>(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    enabled: { type: Boolean, required: true, default: false },
    when: { type: mongoose.Schema.Types.Mixed, required: true },
    encoderId: { type: String, required: true },
    accountId: { type: String },
    offline: { type: Boolean, required: true, default: false },
    startByMs: { type: Number, required: true },
    videos: { type: mongoose.Schema.Types.Mixed, default: [] },
    fireCount: { type: Number, required: true, default: 0 },
    nextAt: { type: Number, default: null },
    lastFire: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  mongoTimestamps,
);

ShortScheduleSchema.index({ enabled: 1, nextAt: 1 }, { name: "short_schedule_due_ix" });
ShortScheduleSchema.index({ "videos.formatId": 1 }, { name: "short_schedule_format_ix" });

export const getShortScheduleModel = (conn: Connection) =>
  getModel<iShortScheduleModel>(conn, "ShortSchedule", ShortScheduleSchema);
