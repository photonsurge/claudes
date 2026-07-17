import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { SatelliteMeta, TleRecord } from "../tracks/types";
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

    /**
     * Join SATCAT metadata onto existing TLEs by noradId. Does NOT upsert: we
     * only describe objects we already track (the catalog is far larger than any
     * one group's TLEs), so meta-only rows would never propagate anyway. Returns
     * how many stored objects were matched and enriched.
     */
    async upsertSatcatMany(
      records: { noradId: string; meta: SatelliteMeta }[],
    ): Promise<{ matched: number }> {
      if (!records.length) return { matched: 0 };
      const ops = records.map((r) => ({
        updateOne: {
          filter: { noradId: r.noradId },
          update: { $set: { meta: r.meta } },
        },
      }));
      const res = await model.bulkWrite(ops);
      return { matched: res.matchedCount ?? 0 };
    },

    async listByGroup(group: string): Promise<TleRecord[]> {
      const docs = await model.find({ groups: group }).lean().exec();
      return docs.map((d) => ({
        name: d.name,
        noradId: d.noradId,
        line1: d.line1,
        line2: d.line2,
        ...(d.meta ? { meta: d.meta } : {}),
      }));
    },

    /**
     * How many of a group's stored objects still lack SATCAT `meta`. Callers use
     * this to skip the (heavily rate-limited) records.php catalog pull once a group
     * is fully enriched — the metadata is static per object, so re-fetching only
     * risks Celestrak's per-IP block without changing anything.
     */
    async countMissingMeta(group: string): Promise<number> {
      return model.countDocuments({ groups: group, meta: { $exists: false } });
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type SatelliteTleRepo = ReturnType<typeof makeSatelliteTleRepo>;
