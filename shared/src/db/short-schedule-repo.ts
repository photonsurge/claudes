import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { defaultShortSchedule, sanitizeShortSchedule, type ShortSchedule, type ShortScheduleFire } from "../short-schedule";
import type { iShortScheduleModel } from "./short-schedule-model";

/**
 * Canonical wire shape from a lean doc: run through the sanitiser onto the
 * defaults, so `_id`/`__v`/timestamps drop and junk in a Mixed blob can't
 * reach the ticker. The server-owned fields (fire count, next and last fire)
 * come from the doc as stored.
 */
function toSchedule(doc: iShortScheduleModel): ShortSchedule {
  const base: ShortSchedule = {
    ...defaultShortSchedule(doc.id, doc.name || "Schedule"),
    fireCount: typeof doc.fireCount === "number" ? doc.fireCount : 0,
    nextAt: typeof doc.nextAt === "number" ? doc.nextAt : null,
  };
  if (doc.lastFire && typeof doc.lastFire === "object") base.lastFire = doc.lastFire as ShortScheduleFire;
  return sanitizeShortSchedule(doc, base);
}

/** Fields a save writes — everything but the id; an absent optional is unset. */
function setDoc({ id: _id, ...rest }: ShortSchedule) {
  const $set: Record<string, unknown> = { ...rest };
  const $unset: Record<string, 1> = {};
  for (const k of ["accountId", "lastFire"] as const) {
    if (rest[k] === undefined) {
      delete $set[k];
      $unset[k] = 1;
    }
  }
  return Object.keys($unset).length ? { $set, $unset } : { $set };
}

/**
 * Schedule persistence (`db.shortSchedules`). Callers pass sanitised schedules
 * (`sanitizeShortSchedule`) with `nextAt` already computed (`scheduleNextAt`).
 * A fire goes through `claimFire`, one conditional update on the `nextAt` it
 * read, so two tickers (or a restart mid-tick) can never fire the same time twice.
 */
export function makeShortScheduleRepo(model: Model<iShortScheduleModel>) {
  return {
    model,

    /** Every schedule, by name. */
    async list(): Promise<ShortSchedule[]> {
      const docs = await model.find({}).sort({ name: 1 }).lean().exec();
      return docs.map((d) => toSchedule(d as iShortScheduleModel));
    },

    async get(id: string): Promise<ShortSchedule | null> {
      const doc = await model.findOne({ id }).lean().exec();
      return doc ? toSchedule(doc as iShortScheduleModel) : null;
    },

    /** Store a new schedule under a fresh id. */
    async create(s: Omit<ShortSchedule, "id">): Promise<ShortSchedule> {
      const schedule = { ...s, id: uuidv4() } as ShortSchedule;
      await model.create(schedule);
      return schedule;
    },

    /** Replace a schedule's fields by id. Returns the stored schedule, or null when it's gone. */
    async save(s: ShortSchedule): Promise<ShortSchedule | null> {
      const doc = await model.findOneAndUpdate({ id: s.id }, setDoc(s), { new: true }).lean().exec();
      return doc ? toSchedule(doc as iShortScheduleModel) : null;
    },

    async remove(id: string): Promise<boolean> {
      const res = await model.deleteOne({ id }).exec();
      return (res.deletedCount ?? 0) > 0;
    },

    /** Enabled schedules whose time has come (`nextAt <= now`), earliest first. */
    async due(now: number): Promise<ShortSchedule[]> {
      const docs = await model
        .find({ enabled: true, nextAt: { $ne: null, $lte: now } })
        .sort({ nextAt: 1 })
        .lean()
        .exec();
      return docs.map((d) => toSchedule(d as iShortScheduleModel));
    },

    /**
     * Take a due fire: only while the schedule is still enabled with the
     * `nextAt` the ticker read. Sets `patch` (the next `nextAt`, `lastFire`,
     * `enabled` for a once schedule) and, with `count`, adds one to `fireCount`.
     * Null when another writer (an edit, another tick) got there first.
     */
    async claimFire(id: string, expectNextAt: number, patch: Partial<ShortSchedule>, count: boolean): Promise<ShortSchedule | null> {
      const update: Record<string, unknown> = { $set: patch };
      if (count) update.$inc = { fireCount: 1 };
      const doc = await model
        .findOneAndUpdate({ id, enabled: true, nextAt: expectNextAt }, update, { new: true })
        .lean()
        .exec();
      return doc ? toSchedule(doc as iShortScheduleModel) : null;
    },

    /**
     * "Run batch now": count a fire and record it, leaving `nextAt` alone. The
     * returned `fireCount` is this fire's `%{n}`.
     */
    async countFire(id: string, lastFire: ShortScheduleFire): Promise<ShortSchedule | null> {
      const doc = await model
        .findOneAndUpdate({ id }, { $inc: { fireCount: 1 }, $set: { lastFire } }, { new: true })
        .lean()
        .exec();
      return doc ? toSchedule(doc as iShortScheduleModel) : null;
    },

    /** Schedules with a video in this format (the format delete guard). */
    async countByFormat(formatId: string): Promise<number> {
      return model.countDocuments({ "videos.formatId": formatId }).exec();
    },
  };
}

export type ShortScheduleRepo = ReturnType<typeof makeShortScheduleRepo>;
