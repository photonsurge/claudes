import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iAlert } from "./alert-model";
import type { Volcano } from "../volcanoes/types";
import type { iWatchedEvent, iWatchedEventModel } from "./watched-event-model";
import type { WatchedEventCore } from "./watched-event-model";
import { alertToWatchedEvent, volcanoToWatchedEvent } from "../events/promote";

const strip = (doc: any): iWatchedEvent => {
  const { __v, _id, ...rest } = doc;
  return rest as iWatchedEvent;
};

export interface WatchedEventListOpts {
  status?: string;
  type?: string;
  bbox?: [number, number, number, number];
  limit?: number;
}

/**
 * The unified event dossier repo. Promotion is an idempotent upsert on the
 * primary key `(primarySource, primarySourceId)` — re-polling the same alert
 * never creates a second event, it just refreshes the lifecycle summary. The
 * full source data stays on the alert/quake doc; this holds only the framing +
 * lifecycle needed to drive the timeline and camera.
 */
export function makeWatchedEventRepo(model: Model<iWatchedEventModel>) {
  /**
   * Idempotent upsert of a WatchedEvent from its derived core, on the primary key
   * `(primarySource, primarySourceId)`. `created` is true only on first insert (so
   * the caller emits an ISSUED beat exactly once). The full geometry is NOT copied
   * — only repPoint + bbox. Shared by every event type's promotion path.
   */
  async function upsertFromCore(core: WatchedEventCore, now: Date): Promise<{ eventId: string; created: boolean }> {
    const existing = await model
      .findOne({ primarySource: core.primarySource, primarySourceId: core.primarySourceId }, { id: 1, _id: 0 })
      .lean<{ id: string }>()
      .exec();
    const id = existing?.id ?? uuidv4();

    const set: Record<string, unknown> = {
      type: core.type,
      status: core.status,
      title: core.title,
      lastSourceUpdateAt: now.toISOString(),
    };
    if (core.repPoint) set.repPoint = core.repPoint;
    if (core.bbox) set.bbox = core.bbox;
    if (core.endedAt) set.endedAt = core.endedAt;

    await model
      .updateOne(
        { primarySource: core.primarySource, primarySourceId: core.primarySourceId },
        {
          $set: set,
          $setOnInsert: {
            id,
            startedAt: core.startedAt || now.toISOString(),
            primarySource: core.primarySource,
            primarySourceId: core.primarySourceId,
          },
        },
        { upsert: true },
      )
      .exec();

    return { eventId: id, created: !existing };
  }

  return {
    model,

    /** Promote (or refresh) a WatchedEvent from its primary alert. */
    async promoteFromAlert(alert: iAlert, now: Date): Promise<{ eventId: string; created: boolean }> {
      return upsertFromCore(alertToWatchedEvent(alert), now);
    },

    /** Promote (or refresh) a WatchedEvent from a volcano observation (type VOLCANO). */
    async promoteFromVolcano(v: Volcano, now: Date): Promise<{ eventId: string; created: boolean }> {
      return upsertFromCore(volcanoToWatchedEvent(v), now);
    },

    async getById(id: string): Promise<iWatchedEvent | null> {
      const doc = await model.findOne({ id }).lean().exec();
      return doc ? strip(doc) : null;
    },

    /** Lookup by the primary source observation (the storm focus branch uses this). */
    async byPrimary(primarySource: string, primarySourceId: string): Promise<iWatchedEvent | null> {
      const doc = await model.findOne({ primarySource, primarySourceId }).lean().exec();
      return doc ? strip(doc) : null;
    },

    async list(opts: WatchedEventListOpts = {}): Promise<iWatchedEvent[]> {
      const q: Record<string, unknown> = {};
      if (opts.status) q.status = opts.status;
      if (opts.type) q.type = opts.type;
      if (opts.bbox) {
        const [w, s, e, n] = opts.bbox;
        q.repPoint = { $geoWithin: { $box: [[w, s], [e, n]] } };
      }
      const docs = await model
        .find(q)
        .sort({ startedAt: -1 })
        .limit(opts.limit && opts.limit > 0 ? opts.limit : 0)
        .lean()
        .exec();
      return docs.map(strip);
    },

    /**
     * Close events whose warning is over.
     *
     * Promotion derives ENDED from `alert.active === false`, but it only ever runs
     * for alerts in a freshly parsed feed — and an alert that lapses never comes
     * through that path. `expire()` and `deactivateMissing()` flip `active` in a
     * bulk updateMany and nothing tells the event, so it stays ACTIVE forever and
     * its watch schedule keeps polling a warning that ended days ago. Live: 2,510
     * ACTIVE schedules against 1,151 alerts that actually qualify, every acquire
     * reporting `changed: false`.
     *
     * Third instance of the same bug in this ingest — a derived record with no path
     * back when its source changes. See resyncMeteoalarmRanks and
     * reconcileCachedGeometry.
     */
    async closeMany(rows: { id: string; endedAt?: string }[]): Promise<number> {
      if (!rows.length) return 0;
      const res = await model.bulkWrite(
        rows.map((r) => ({
          updateOne: {
            // Guard on ACTIVE so a CANCELLED event is never quietly rewritten to
            // ENDED: the issuer withdrawing a warning and the warning lapsing are
            // different stories, and the timeline renders them differently.
            filter: { id: r.id, status: "ACTIVE" },
            update: { $set: { status: "ENDED", ...(r.endedAt ? { endedAt: r.endedAt } : {}) } },
          },
        })),
        { ordered: false },
      );
      return res.modifiedCount ?? 0;
    },

    /** Mark the last acquisition sweep instant (called by the watcher). */
    async touchChecked(id: string, now: Date): Promise<void> {
      await model.updateOne({ id }, { $set: { lastCheckedAt: now.toISOString() } }).exec();
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type WatchedEventRepo = ReturnType<typeof makeWatchedEventRepo>;
