import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iCapIdModel } from "./cap-id-model";

export interface CapIdInput {
  capurl: string;
  capId: string | null;
  sender?: string;
}

/**
 * The capurl → canonical CAP identifier cache. Write-once by nature (a capurl is
 * content-addressed, so its CAP message never changes), and read on every alerts
 * ingest tick — so the lookup is one batched query, never a loop.
 */
export function makeCapIdRepo(capIdModel: Model<iCapIdModel>) {
  return {
    capIdModel,

    async upsertMany(rows: CapIdInput[]): Promise<{ upserted: number }> {
      if (!rows.length) return { upserted: 0 };
      const fetchedAt = new Date();
      await capIdModel.bulkWrite(
        rows.map((r) => ({
          updateOne: {
            filter: { capurl: r.capurl },
            update: {
              $set: { capId: r.capId, sender: r.sender, fetchedAt },
              $setOnInsert: { id: uuidv4(), capurl: r.capurl },
            },
            upsert: true,
          },
        })),
        // A race with another worker on the same capurl is a duplicate-key, not a
        // failure — the row we wanted exists.
        { ordered: false },
      );
      return { upserted: rows.length };
    },

    /** Batched capurl → capId lookup for the ingest enrich. Nulls are omitted. */
    async byCapurls(capurls: string[]): Promise<Map<string, string>> {
      const keys = [...new Set(capurls.filter(Boolean))];
      if (!keys.length) return new Map();
      const docs = await capIdModel
        .find({ capurl: { $in: keys }, capId: { $ne: null } }, { capurl: 1, capId: 1 })
        .lean()
        .exec();
      return new Map(docs.map((d: any) => [d.capurl, d.capId]));
    },

    /** capurls we've already resolved (including known-null) — the sync skips these. */
    async knownCapurls(capurls: string[]): Promise<Set<string>> {
      const keys = [...new Set(capurls.filter(Boolean))];
      if (!keys.length) return new Set();
      const docs = await capIdModel.find({ capurl: { $in: keys } }, { capurl: 1 }).lean().exec();
      return new Set(docs.map((d: any) => d.capurl));
    },

    async count(): Promise<{ total: number; resolved: number }> {
      const [total, resolved] = await Promise.all([
        capIdModel.estimatedDocumentCount(),
        capIdModel.countDocuments({ capId: { $ne: null } }),
      ]);
      return { total, resolved };
    },
  };
}

export type CapIdRepo = ReturnType<typeof makeCapIdRepo>;
