import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iEventSource, iEventSourceModel } from "./event-source-model";

const strip = (doc: any): iEventSource => {
  const { __v, _id, ...rest } = doc;
  return rest as iEventSource;
};

export interface ObserveSourceInput {
  eventId: string;
  source: string;
  sourceEventId: string;
  sourceUrl?: string;
  payloadHash: string;
  normalized: Record<string, unknown>;
  now: Date;
}

/**
 * Latest-observation-per-source store. `observe` upserts the current normalized
 * snapshot and reports whether it CHANGED (payloadHash moved) — the acquire job
 * uses that to decide whether to append a revision + timeline beat, so unchanged
 * re-polls produce no history noise. First-seen is reported so the caller can
 * emit a SOURCE_LINKED beat once.
 */
export function makeEventSourceRepo(model: Model<iEventSourceModel>) {
  return {
    model,

    async observe(input: ObserveSourceInput): Promise<{ changed: boolean; firstSeen: boolean }> {
      const iso = input.now.toISOString();
      const existing = await model
        .findOne({ eventId: input.eventId, source: input.source }, { currentPayloadHash: 1, _id: 0 })
        .lean<{ currentPayloadHash: string }>()
        .exec();
      const firstSeen = !existing;
      const changed = firstSeen || existing!.currentPayloadHash !== input.payloadHash;

      const set: Record<string, unknown> = {
        sourceEventId: input.sourceEventId,
        sourceUrl: input.sourceUrl,
        lastSeenAt: iso,
      };
      if (changed) {
        set.currentPayloadHash = input.payloadHash;
        set.normalized = input.normalized;
        set.lastChangedAt = iso;
      }

      await model
        .updateOne(
          { eventId: input.eventId, source: input.source },
          { $set: set, $setOnInsert: { id: uuidv4(), firstSeenAt: iso } },
          { upsert: true },
        )
        .exec();

      return { changed, firstSeen };
    },

    async listForEvent(eventId: string): Promise<iEventSource[]> {
      const docs = await model.find({ eventId }).sort({ firstSeenAt: 1 }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type EventSourceRepo = ReturnType<typeof makeEventSourceRepo>;
