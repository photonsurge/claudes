import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iEventWatchSchedule, iEventWatchScheduleModel } from "./event-watch-schedule-model";

const strip = (doc: any): iEventWatchSchedule => {
  const { __v, _id, ...rest } = doc;
  return rest as iEventWatchSchedule;
};

/** Cap the exponential backoff so a persistently-failing source still gets retried. */
const MAX_BACKOFF_MULT = 8;

export interface UpsertScheduleInput {
  eventId: string;
  source: string;
  intervalSeconds: number;
  /** First-check instant on insert; defaults to now. */
  nextCheckAt?: Date;
}

/**
 * Per-event acquisition schedule. `upsert` registers/updates a source's cadence
 * (bumping `intervalSeconds` as severity changes, WITHOUT resetting an already
 * scheduled `nextCheckAt`). `due` feeds the sweeper. `reschedule` advances
 * `nextCheckAt` after an acquire — on failure it backs off exponentially.
 */
export function makeEventWatchScheduleRepo(model: Model<iEventWatchScheduleModel>) {
  return {
    model,

    async upsert(input: UpsertScheduleInput): Promise<void> {
      await model
        .updateOne(
          { eventId: input.eventId, source: input.source },
          {
            $set: { intervalSeconds: input.intervalSeconds },
            $setOnInsert: {
              id: uuidv4(),
              nextCheckAt: input.nextCheckAt ?? new Date(),
              failureCount: 0,
            },
          },
          { upsert: true },
        )
        .exec();
    },

    /** Rows due for a check (nextCheckAt ≤ now), soonest first. */
    async due(now: Date, limit: number): Promise<iEventWatchSchedule[]> {
      const docs = await model
        .find({ nextCheckAt: { $lte: now } })
        .sort({ nextCheckAt: 1 })
        .limit(limit > 0 ? limit : 0)
        .lean()
        .exec();
      return docs.map(strip);
    },

    /** Advance the schedule after an acquire. `ok=false` backs off exponentially. */
    async reschedule(
      eventId: string,
      source: string,
      opts: { intervalSeconds?: number; ok: boolean; now?: Date },
    ): Promise<void> {
      const now = opts.now ?? new Date();
      const cur = await model.findOne({ eventId, source }).lean<iEventWatchSchedule>().exec();
      const baseInterval = opts.intervalSeconds ?? cur?.intervalSeconds ?? 900;
      const failureCount = opts.ok ? 0 : (cur?.failureCount ?? 0) + 1;
      const mult = opts.ok ? 1 : Math.min(2 ** failureCount, MAX_BACKOFF_MULT);
      const nextCheckAt = new Date(now.getTime() + baseInterval * mult * 1000);

      const set: Record<string, unknown> = {
        intervalSeconds: baseInterval,
        failureCount,
        nextCheckAt,
        lastCheckedAt: now,
      };
      if (opts.ok) set.lastSuccessAt = now;

      await model
        .updateOne({ eventId, source }, { $set: set, $setOnInsert: { id: uuidv4() } }, { upsert: true })
        .exec();
    },

    /**
     * Stop watching these events for good.
     *
     * A schedule outlives its event: nothing retired them, so 1,348 of 3,858 live
     * schedules were polling events that had already ENDED, on top of ~1,359 more
     * whose event was still marked ACTIVE only because nothing closed it. That was
     * ~70% of a queue running 25x beyond its own throughput, every acquire
     * answering `changed: false`.
     *
     * Deleted, not flagged: a schedule is pure "when to look next" — it carries no
     * history worth keeping, and the event it points at holds the whole story. If
     * the event ever reopens, promotion re-upserts the schedule from scratch.
     */
    async removeForEvents(eventIds: string[]): Promise<number> {
      if (!eventIds.length) return 0;
      const res = await model.deleteMany({ eventId: { $in: eventIds } }).exec();
      return res.deletedCount ?? 0;
    },

    async listForEvent(eventId: string): Promise<iEventWatchSchedule[]> {
      const docs = await model.find({ eventId }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type EventWatchScheduleRepo = ReturnType<typeof makeEventWatchScheduleRepo>;
