import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { AlertGeometry } from "./alert-model";
import type { iAdminAreaGeomModel } from "./admin-area-geom-model";

/** One admin area to store, as the importer hands it over. */
export interface AdminAreaInput {
  scheme: string;
  code: string;
  countryCode?: string;
  name?: string;
  geometry: AlertGeometry;
  source?: string;
}

/** The key a (scheme, code) pair joins on — kept identical on read and write. */
export const adminKey = (scheme: string, code: string): string =>
  `${scheme.toUpperCase()}:${code.toUpperCase()}`;

/**
 * The `(scheme, code) → boundary` static reference table. Reads are the hot path
 * (the ingest geometry enrich looks up every NUTS-coded area per tick), so the
 * lookup is a single batched query keyed the same way it's written.
 */
export function makeAdminAreaGeomRepo(model: Model<iAdminAreaGeomModel>) {
  return {
    model,

    /**
     * Boundaries for a set of (scheme, code) pairs, as a Map keyed by `adminKey`.
     * One `$or` query, deduped — never a lookup per code.
     */
    async byCodes(pairs: { scheme: string; code: string }[]): Promise<Map<string, AlertGeometry>> {
      const seen = new Set<string>();
      const or: { scheme: string; code: string }[] = [];
      for (const p of pairs) {
        const k = adminKey(p.scheme, p.code);
        if (seen.has(k)) continue;
        seen.add(k);
        or.push({ scheme: p.scheme.toUpperCase(), code: p.code.toUpperCase() });
      }
      if (!or.length) return new Map();
      const docs = (await model
        .find({ $or: or }, { _id: 0, scheme: 1, code: 1, geometry: 1 })
        .lean()
        .exec()) as unknown as { scheme: string; code: string; geometry: AlertGeometry }[];
      return new Map(docs.map((d) => [adminKey(d.scheme, d.code), d.geometry]));
    },

    /**
     * Bulk-upsert an import. Keyed on (scheme, code) so a re-import refreshes each
     * area in place — the table is rewritten wholesale without duplicating rows.
     * Codes are stored upper-cased so the join is case-insensitive.
     */
    async upsertMany(areas: AdminAreaInput[]): Promise<{ upserted: number }> {
      if (!areas.length) return { upserted: 0 };
      const fetchedAt = new Date();
      const r = await model.bulkWrite(
        areas.map((a) => ({
          updateOne: {
            filter: { scheme: a.scheme.toUpperCase(), code: a.code.toUpperCase() },
            update: {
              $set: {
                countryCode: a.countryCode,
                name: a.name,
                geometry: a.geometry,
                source: a.source ?? "gisco",
                fetchedAt,
              },
              $setOnInsert: { id: uuidv4() },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      return { upserted: (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0) };
    },

    async count(): Promise<{ areas: number; bySchemeSample: Record<string, number> }> {
      const areas = await model.estimatedDocumentCount();
      const agg = (await model
        .aggregate([{ $group: { _id: "$scheme", n: { $sum: 1 } } }])
        .exec()) as { _id: string; n: number }[];
      return { areas, bySchemeSample: Object.fromEntries(agg.map((a) => [a._id, a.n])) };
    },
  };
}

export type AdminAreaGeomRepo = ReturnType<typeof makeAdminAreaGeomRepo>;
