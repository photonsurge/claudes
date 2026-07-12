import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { Quake } from "../tracks/types";
import type { iQuakeModel } from "./quake-model";

const strip = (doc: any): iQuakeModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iQuakeModel;
};

/**
 * Earthquake persistence + overlay reads. `upsertMany` dedups on the USGS
 * `quakeId` (a re-poll refreshes magnitude/depth without duplicating); `list`
 * returns recent events newest-first, optionally clipped by magnitude and bbox.
 */
export function makeQuakeRepo(model: Model<iQuakeModel>) {
  return {
    model,

    /** Upsert a batch of quakes on `quakeId`. Fills the GeoJSON `loc`. */
    async upsertMany(quakes: Quake[]): Promise<{ upserted: number; matched: number }> {
      if (!quakes.length) return { upserted: 0, matched: 0 };
      const fetchedAt = new Date();
      const ops = quakes.map((q) => ({
        updateOne: {
          filter: { quakeId: q.id },
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
              fetchedAt,
              loc: { type: "Point" as const, coordinates: [q.lng, q.lat] as [number, number] },
            },
            $setOnInsert: { id: uuidv4() },
          },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** Recent quakes (newest first), optionally filtered by magnitude/bbox. */
    async list(opts: {
      minMag?: number;
      bbox?: [number, number, number, number];
      limit?: number;
    } = {}): Promise<iQuakeModel[]> {
      const q: Record<string, unknown> = {};
      if (typeof opts.minMag === "number") q.mag = { $gte: opts.minMag };
      if (opts.bbox) {
        const [w, s, e, n] = opts.bbox;
        q.loc = {
          $geoWithin: { $geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } },
        };
      }
      let query = model.find(q).sort({ time: -1 }).limit(opts.limit ?? 2000);
      // Force the geo index on bbox reads so the planner skips its multi-plan
      // trial run — otherwise it may walk `quake_time_mag_ix` filtering by geo
      // and burn 100ms+ of planningTimeMicros (and replan across box sizes).
      if (opts.bbox) query = query.hint("quake_geo_ix");
      const docs = await query.lean().exec();
      return docs.map(strip);
    },

    /** A single quake by its USGS id (the admin detail read), or null. */
    async get(quakeId: string): Promise<iQuakeModel | null> {
      const doc = await model.findOne({ quakeId }).lean().exec();
      return doc ? strip(doc) : null;
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type QuakeRepo = ReturnType<typeof makeQuakeRepo>;
