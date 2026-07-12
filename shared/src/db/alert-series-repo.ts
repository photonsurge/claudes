import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iAlertSeries, iAlertSeriesModel } from "./alert-series-model";

/** Cap samples per series so a long-lived alert can't grow unbounded. */
const SAMPLE_CAP = 500;

const strip = (doc: any): iAlertSeries => {
  const { __v, _id, ...rest } = doc;
  return rest as iAlertSeries;
};

export interface AppendSampleInput {
  source: string;
  identifier: string;
  alertId?: string;
  metric: string;
  value: number;
  /** epoch ms */
  t: number;
  lng?: number;
  lat?: number;
}

/**
 * Rolling alert-metric series. One writer (the GDACS harvest post-step), append
 * a sample only when the value actually MOVES (an unchanged re-poll just bumps
 * `updatedAt` to keep the TTL alive) — so the series is deltas-over-time, cheap
 * to store and graph. Mirrors tide-series-repo.
 */
export function makeAlertSeriesRepo(model: Model<iAlertSeriesModel>) {
  return {
    model,

    /** Append a sample for `(source, identifier, metric)`, deduping unchanged values. */
    async appendSample(s: AppendSampleInput): Promise<{ appended: boolean }> {
      const key = `${s.source}:${s.identifier}:${s.metric}`;
      const existing = await model.findOne({ key }, { samples: { $slice: -1 } }).lean().exec();
      const last = existing?.samples?.[0];
      if (last && last.v === s.value) {
        // Value unchanged — keep the TTL alive without growing the series.
        await model.updateOne({ key }, { $set: { updatedAt: new Date(s.t) } }).exec();
        return { appended: false };
      }
      const set: Record<string, unknown> = {
        source: s.source,
        identifier: s.identifier,
        metric: s.metric,
        latest: s.value,
        updatedAt: new Date(s.t),
      };
      if (s.alertId) set.alertId = s.alertId;
      if (typeof s.lng === "number" && typeof s.lat === "number") {
        set.loc = { type: "Point" as const, coordinates: [s.lng, s.lat] as [number, number] };
      }
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

    /** Every metric series for one alert (for the graph slide). */
    async listForAlert(source: string, identifier: string): Promise<iAlertSeries[]> {
      const docs = await model.find({ source, identifier }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type AlertSeriesRepo = ReturnType<typeof makeAlertSeriesRepo>;
