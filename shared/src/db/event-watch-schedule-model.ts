import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * The per-event, per-source acquisition cadence. Instead of a BullMQ repeatable
 * per event (which would stampede as events spawn), ONE `events.watch` sweeper
 * ticks, reads the rows whose `nextCheckAt` is due, dispatches an acquire, and
 * reschedules — so all per-event cadence (RED 2m / ORANGE 5m / GREEN 15m, decayed
 * by age) lives here in Mongo. `failureCount` drives exponential backoff.
 */

export interface iEventWatchSchedule extends iGeneralModel {
  eventId: string;
  source: string;
  nextCheckAt: Date;
  intervalSeconds: number;
  failureCount: number;
  lastSuccessAt?: Date;
  lastCheckedAt?: Date;
}

export interface iEventWatchScheduleModel extends iEventWatchSchedule {
  id: string;
  _id: string;
}

export const EventWatchScheduleSchema = new mongoose.Schema<iEventWatchScheduleModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    eventId: { type: String, required: true },
    source: { type: String, required: true },
    nextCheckAt: { type: Date, required: true, default: () => new Date() },
    intervalSeconds: { type: Number, required: true, default: 900 },
    failureCount: { type: Number, required: true, default: 0 },
    lastSuccessAt: { type: Date, required: false },
    lastCheckedAt: { type: Date, required: false },
  },
  { timestamps: false },
);

EventWatchScheduleSchema.index({ eventId: 1, source: 1 }, { unique: true, name: "event_watch_key_ix" });
EventWatchScheduleSchema.index({ nextCheckAt: 1 }, { name: "event_watch_due_ix" });

export const getEventWatchScheduleModel = (conn: Connection) =>
  getModel<iEventWatchScheduleModel>(conn, "EventWatchSchedule", EventWatchScheduleSchema);
