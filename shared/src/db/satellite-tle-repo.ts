import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { TleRecord } from "../tracks/types";
import type { iSatelliteTleModel } from "./satellite-tle-model";

/**
 * TLE persistence. `upsertMany` dedups on `noradId` and unions the `groups` set,
 * so re-ingesting a group refreshes elements without losing membership in other
 * feeds. `listByGroup` returns plain `TleRecord`s ready to propagate.
 */
export function makeSatelliteTleRepo(model: Model<iSatelliteTleModel>) {
  return {
    model,

    async upsertMany(records: TleRecord[], group: string): Promise<{ upserted: number; matched: number }> {
      if (!records.length) return { upserted: 0, matched: 0 };
      const now = new Date().toISOString();
      const ops = records.map((r) => ({
        updateOne: {
          filter: { noradId: r.noradId },
          update: {
            $set: { name: r.name, line1: r.line1, line2: r.line2, fetchedAt: now },
            $setOnInsert: { id: uuidv4() },
            $addToSet: { groups: group },
          },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    async listByGroup(group: string): Promise<TleRecord[]> {
      const docs = await model.find({ groups: group }).lean().exec();
      return docs.map((d) => ({ name: d.name, noradId: d.noradId, line1: d.line1, line2: d.line2 }));
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type SatelliteTleRepo = ReturnType<typeof makeSatelliteTleRepo>;
