import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iEventSeries, iEventSeriesModel } from "./event-series-model";

/** Cap samples per series so a long-lived event can't grow unbounded. */
const SAMPLE_CAP = 500;

const strip = (doc: any): iEventSeries => {
  const { __v, _id, ...rest } = doc;
  return rest as iEventSeries;
};

export interface AppendEventSampleInput {
  eventId: string;
  source: string;
  metric: string;
  value: number;
  /** epoch ms */
  t: number;
  unit?: string;
}

/**
 * Rolling event-metric series. Append a sample only when the value MOVES (an
 * unchanged re-poll just bumps `updatedAt` to keep the TTL alive) — deltas over
 * time, cheap to store and graph. Generic clone of alert-series-repo.
 */
export function makeEventSeriesRepo(model: Model<iEventSeriesModel>) {
  return {
    model,

    async appendSample(s: AppendEventSampleInput): Promise<{ appended: boolean }> {
      const key = `${s.eventId}:${s.source}:${s.metric}`;
      const existing = await model.findOne({ key }, { samples: { $slice: -1 } }).lean().exec();
      const last = existing?.samples?.[0];
      if (last && last.v === s.value) {
        await model.updateOne({ key }, { $set: { updatedAt: new Date(s.t) } }).exec();
        return { appended: false };
      }
      const set: Record<string, unknown> = {
        eventId: s.eventId,
        source: s.source,
        metric: s.metric,
        latest: s.value,
        updatedAt: new Date(s.t),
      };
      if (s.unit) set.unit = s.unit;
      await model
        .updateOne(
          { key },
          {
            $set: set,
            $push: { samples: { $each: [{ t: s.t, v: s.value }], $slice: -SAMPLE_CAP } },
            $setOnInsert: { id: uuidv4() },
          },
          { upsert: true },
        )
        .exec();
      return { appended: true };
    },

    async listForEvent(eventId: string): Promise<iEventSeries[]> {
      const docs = await model.find({ eventId }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type EventSeriesRepo = ReturnType<typeof makeEventSeriesRepo>;
