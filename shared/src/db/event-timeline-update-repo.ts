import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iEventTimelineUpdate, iEventTimelineUpdateModel, NewEventTimelineUpdate } from "./event-timeline-update-model";

const strip = (doc: any): iEventTimelineUpdate => {
  const { __v, _id, ...rest } = doc;
  return rest as iEventTimelineUpdate;
};

/**
 * Stored event timeline beats. `appendMany` is idempotent on the natural key
 * `(eventId, type, at, source, refUrl)` — a re-poll of the same report/product
 * (same instant + url) refreshes the row instead of duplicating a beat. Promotion
 * beats (no url) are naturally single per change since ingest only diffs on a
 * real change. Many writers, one reader (buildEventTimeline).
 */
export function makeEventTimelineUpdateRepo(model: Model<iEventTimelineUpdateModel>) {
  return {
    model,

    /** Append beats, deduped by natural key. Returns how many were newly inserted. */
    async appendMany(updates: NewEventTimelineUpdate[]): Promise<{ inserted: number }> {
      if (!updates.length) return { inserted: 0 };
      const ops = updates.map((u) => ({
        updateOne: {
          filter: {
            eventId: u.eventId,
            type: u.type,
            at: u.at,
            source: u.source ?? null,
            refUrl: u.refUrl ?? null,
          },
          update: {
            $set: {
              label: u.label,
              summary: u.summary,
              severityRank: u.severityRank,
              areaKm2: u.areaKm2,
              payloadHash: u.payloadHash,
              data: u.data,
              assetIds: u.assetIds,
            },
            $setOnInsert: { id: uuidv4() },
          },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { inserted: res.upsertedCount ?? 0 };
    },

    /** All beats for one event, oldest-first (raw material for buildEventTimeline). */
    async listForEvent(eventId: string): Promise<iEventTimelineUpdate[]> {
      const docs = await model.find({ eventId }).sort({ at: 1 }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type EventTimelineUpdateRepo = ReturnType<typeof makeEventTimelineUpdateRepo>;
