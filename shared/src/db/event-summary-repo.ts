import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iEventSummary, iEventSummaryModel, SummaryPeriod } from "./event-summary-model";

const strip = (doc: any): iEventSummaryModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iEventSummaryModel;
};

/**
 * Round-up persistence + reads. `create` appends a fresh summary (history is the
 * point — never overwrite); `latest` backs the admin screen's current view;
 * `list` powers the history panel. Newest-first by `generatedAt`.
 */
export function makeEventSummaryRepo(model: Model<iEventSummaryModel>) {
  return {
    model,

    /** Append a fresh round-up. */
    async create(summary: iEventSummary): Promise<iEventSummaryModel> {
      const doc = await model.create({ id: uuidv4(), ...summary });
      return strip(doc.toObject());
    },

    /** Newest round-up for a cadence, or null. */
    async latest(period: SummaryPeriod): Promise<iEventSummaryModel | null> {
      const doc = await model.findOne({ period }).sort({ generatedAt: -1 }).lean().exec();
      return doc ? strip(doc) : null;
    },

    /** History newest-first, optionally scoped to one cadence. */
    async list(
      opts: { period?: SummaryPeriod; limit?: number } = {},
    ): Promise<iEventSummaryModel[]> {
      const q: Record<string, unknown> = {};
      if (opts.period) q.period = opts.period;
      const docs = await model
        .find(q)
        .sort({ generatedAt: -1 })
        .limit(opts.limit ?? 20)
        .lean()
        .exec();
      return docs.map(strip);
    },
  };
}

export type EventSummaryRepo = ReturnType<typeof makeEventSummaryRepo>;
