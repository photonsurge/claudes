import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iEventWatchSchedule, iEventWatchScheduleModel } from "./event-watch-schedule-model";

const strip = (doc: any): iEventWatchSchedule => {
  const { __v, _id, ...rest } = doc;
  return rest as iEventWatchSchedule;
};

/** Cap the exponential backoff so a persistently-failing source still gets retried. */
const MAX_BACKOFF_MULT = 8;

/**
 * The aggregation stages `reschedule` writes with — extracted and pure because
 * this is where the actual risk lives: it is arithmetic expressed as data, and a
 * wrong `$pow` or a missing `$ifNull` doesn't throw, it just schedules the next
 * check at the wrong time and nothing ever says so.
 *
 * Two stages, and the order matters: stage 2 reads `intervalSeconds` and
 * `failureCount` as stage 1 just set them, so the backoff is computed from the
 * NEW failure count rather than the stale one.
 *
 * `$ifNull` throughout because this upserts: on insert every `$field` reference
 * is null, and a null interval would silently become a null nextCheckAt — a
 * schedule that is never due again.
 */
export function rescheduleStages(
  opts: { intervalSeconds?: number; ok: boolean },
  now: Date,
  newId: string,
): Record<string, unknown>[] {
  // Success resets to the plain cadence; failure doubles per consecutive failure,
  // capped so a permanently broken source still gets retried rather than receding
  // to the heat death of the universe.
  const mult = opts.ok ? 1 : { $min: [{ $pow: [2, "$failureCount"] }, MAX_BACKOFF_MULT] };

  return [
    {
      $set: {
        // Keep the existing id; mint one only on insert (a pipeline update has no
        // $setOnInsert, so this is how "insert-only" is expressed).
        id: { $ifNull: ["$id", newId] },
        intervalSeconds: opts.intervalSeconds ?? { $ifNull: ["$intervalSeconds", 900] },
        failureCount: opts.ok ? 0 : { $add: [{ $ifNull: ["$failureCount", 0] }, 1] },
        lastCheckedAt: now,
        ...(opts.ok ? { lastSuccessAt: now } : {}),
      },
    },
    {
      $set: {
        nextCheckAt: { $add: [now, { $multiply: ["$intervalSeconds", 1000, mult] }] },
      },
    },
  ];
}

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
    /**
     * The next events to acquire: never-looked-at ones FIRST, then whatever is
     * most overdue.
     *
     * Ordering by `nextCheckAt` alone is the obvious scheduler and it is subtly
     * backwards under load. Promotion starts a new event at `nextCheckAt = now`,
     * while a backlog item is overdue from hours or days ago — so ascending order
     * puts "overdue since last Tuesday" AHEAD of a red warning issued sixty
     * seconds ago, and a new event waits out the entire queue for its first look.
     * Measured with a 3,758-deep backlog: 103 events had never been checked at all.
     *
     * That is exactly the wrong way round. A brand-new severe warning is the most
     * interesting thing this system sees; a week-old one going unpolled for another
     * ten minutes costs nothing.
     *
     * Two phases rather than a combined sort, because they answer different
     * questions: "has this ever been seen" is a boolean, and mixing it into the
     * ordering (sort by lastCheckedAt) would break interval-respect — a red on a
     * 5-minute cadence checked recently would sort behind an orange on 30 minutes
     * checked slightly less recently, which is the wrong priority for both.
     *
     * Both phases are covered: phase 1 by the sparse-ish `lastCheckedAt` scan over
     * a handful of new rows, phase 2 by `event_watch_due_ix`.
     */
    async due(now: Date, limit: number): Promise<iEventWatchSchedule[]> {
      if (limit <= 0) limit = 0;

      // Phase 1: anything we have never acquired, oldest event first. Normally a
      // handful — the ones promoted since the last tick.
      const fresh = await model
        .find({ lastCheckedAt: { $in: [null, undefined] }, nextCheckAt: { $lte: now } })
        .sort({ nextCheckAt: 1 })
        .limit(limit)
        .lean()
        .exec();

      const remaining = limit ? limit - fresh.length : 0;
      if (limit && remaining <= 0) return fresh.map(strip);

      // Phase 2: the established rotation — most overdue first. This is the fair
      // round-robin: `reschedule` pushes a checked event to the back, so nothing
      // starves once it has been seen once.
      const docs = await model
        .find({ lastCheckedAt: { $nin: [null, undefined] }, nextCheckAt: { $lte: now } })
        .sort({ nextCheckAt: 1 })
        .limit(remaining)
        .lean()
        .exec();

      return [...fresh, ...docs].map(strip);
    },

    /**
     * Advance the schedule after an acquire. `ok=false` backs off exponentially.
     *
     * ONE round-trip. This was a `findOne` followed by an `updateOne` — two trips
     * per event, and the sweeper does this for every event it dispatches (50 a
     * tick). It was also a read-then-write on `failureCount`: the value is read in
     * the app and written back, so a concurrent reschedule for the same event
     * (`watch` advances optimistically, `acquire` backs off on failure) can read
     * the same count twice and lose an increment — a persistently failing source
     * then never reaches its backoff cap.
     *
     * A pipeline update computes both server-side from the document's own current
     * value, so the increment is atomic and the read disappears. See
     * `rescheduleStages` for the arithmetic, which is where the risk actually is.
     */
    async reschedule(
      eventId: string,
      source: string,
      opts: { intervalSeconds?: number; ok: boolean; now?: Date },
    ): Promise<void> {
      const now = opts.now ?? new Date();
      await model
        .updateOne({ eventId, source }, rescheduleStages(opts, now, uuidv4()) as never, { upsert: true })
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
