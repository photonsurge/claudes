import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iQuakeArchiveModel } from "./quake-archive-model";

const strip = (doc: any): iQuakeArchiveModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iQuakeArchiveModel;
};

/** What the archive job hands over — the subset of a Quake worth keeping forever. */
export interface ArchivableQuake {
  quakeId: string;
  mag: number;
  place?: string;
  time: Date | string;
  lng: number;
  lat: number;
  depthKm: number;
  url?: string;
  tsunami?: boolean;
}

/**
 * The permanent seismic record. Reads mirror `quakes` so a caller can swap
 * between the live working set and the archive without reshaping anything.
 */
export function makeQuakeArchiveRepo(model: Model<iQuakeArchiveModel>) {
  return {
    model,

    /**
     * Copy events into the permanent record, upserting on `quakeId`. Idempotent:
     * re-running over the same window rewrites the same rows (and picks up a
     * USGS magnitude revision), so the daily job can safely overlap itself.
     */
    async archiveMany(quakes: ArchivableQuake[]): Promise<{ archived: number; updated: number }> {
      if (!quakes.length) return { archived: 0, updated: 0 };
      const archivedAt = new Date();
      const ops = quakes.map((q) => ({
        updateOne: {
          filter: { quakeId: q.quakeId },
          update: {
            $set: {
              mag: q.mag,
              place: q.place,
              time: new Date(q.time),
              lng: q.lng,
              lat: q.lat,
              depthKm: q.depthKm,
              url: q.url,
              tsunami: q.tsunami ?? false,
              loc: { type: "Point" as const, coordinates: [q.lng, q.lat] as [number, number] },
            },
            $setOnInsert: { id: uuidv4(), archivedAt },
          },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { archived: res.upsertedCount ?? 0, updated: res.matchedCount ?? 0 };
    },

    /** Archived events newest-first, optionally clipped by magnitude, time or bbox. */
    async list(
      opts: {
        minMag?: number;
        bbox?: [number, number, number, number];
        limit?: number;
        fromMs?: number;
        toMs?: number;
      } = {},
    ): Promise<iQuakeArchiveModel[]> {
      const q: Record<string, unknown> = {};
      if (typeof opts.minMag === "number") q.mag = { $gte: opts.minMag };
      if (typeof opts.fromMs === "number" || typeof opts.toMs === "number") {
        const t: Record<string, Date> = {};
        if (typeof opts.fromMs === "number") t.$gte = new Date(opts.fromMs);
        if (typeof opts.toMs === "number") t.$lte = new Date(opts.toMs);
        q.time = t;
      }
      if (opts.bbox) {
        const [w, s, e, n] = opts.bbox;
        q.loc = {
          $geoWithin: { $geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } },
        };
      }
      let query = model.find(q).sort({ time: -1 }).limit(opts.limit ?? 2000);
      // Same planner-thrash guard the live collection uses on bbox reads.
      if (opts.bbox) query = query.hint("quake_arch_geo_ix");
      const docs = await query.lean().exec();
      return docs.map(strip);
    },

    /** The ids already in the record, for a given set — so the job skips re-writing. */
    async existingIds(quakeIds: string[]): Promise<Set<string>> {
      if (!quakeIds.length) return new Set();
      const docs = await model
        .find({ quakeId: { $in: quakeIds } }, { quakeId: 1, _id: 0 })
        .lean<{ quakeId: string }[]>()
        .exec();
      return new Set(docs.map((d) => d.quakeId));
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type QuakeArchiveRepo = ReturnType<typeof makeQuakeArchiveRepo>;
