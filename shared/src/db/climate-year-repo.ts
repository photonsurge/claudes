import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { ClimateYear } from "../climate/types";
import { climateKey } from "../climate/types";
import type { iClimateYearModel } from "./climate-year-model";

const strip = (doc: any): ClimateYear & { fetchedAt: number } => ({
  lat: doc.lat,
  lng: doc.lng,
  dates: doc.dates ?? [],
  datasets: doc.datasets ?? [],
  fetchedAt: new Date(doc.fetchedAt).getTime(),
});

/** A cached climate year plus its great-circle distance from the query point. */
export interface NearestClimate {
  climate: ClimateYear & { fetchedAt: number };
  distanceKm: number;
}

/**
 * Past-year climate cache persistence + nearest lookup. The worker `upsert`s
 * one doc per on-air focus point; the public /climate route reads the single
 * `nearest` cached doc to the requested point (or null when none is in range —
 * the panel section then hides).
 */
export function makeClimateYearRepo(model: Model<iClimateYearModel>) {
  return {
    model,

    /** Upsert one point's past-year climate on `key`. */
    async upsert(year: ClimateYear): Promise<void> {
      const key = climateKey(year.lat, year.lng);
      await model.updateOne(
        { key },
        {
          $set: {
            lat: year.lat,
            lng: year.lng,
            dates: year.dates,
            datasets: year.datasets,
            fetchedAt: new Date(),
            loc: { type: "Point" as const, coordinates: [year.lng, year.lat] as [number, number] },
          },
          $setOnInsert: { id: uuidv4() },
        },
        { upsert: true },
      );
    },

    /** When this key was last fetched (ms epoch), or null if never cached. */
    async fetchedAtByKey(key: string): Promise<number | null> {
      const doc = await model.findOne({ key }).select({ fetchedAt: 1 }).lean();
      return doc ? new Date(doc.fetchedAt).getTime() : null;
    },

    /**
     * Of `keys`, the subset already cached with `fetchedAt >= minFetchedAt` — one
     * query, so the all-city backfill can skip the fresh keys and only fetch the
     * stale ones (mirrors cities.enrichWikiAll's staleness-driven batching).
     */
    async freshKeys(keys: string[], minFetchedAt: Date): Promise<Set<string>> {
      if (!keys.length) return new Set();
      const docs = await model
        .find({ key: { $in: keys }, fetchedAt: { $gte: minFetchedAt } })
        .select({ key: 1, _id: 0 })
        .lean();
      return new Set(docs.map((d: any) => d.key as string));
    },

    /** Nearest cached climate to `[lng,lat]`, within `maxKm` if given, else null. */
    async nearest(opts: { lng: number; lat: number; maxKm?: number }): Promise<NearestClimate | null> {
      const geoNear: Record<string, unknown> = {
        near: { type: "Point", coordinates: [opts.lng, opts.lat] },
        distanceField: "distanceM",
        spherical: true,
      };
      if (typeof opts.maxKm === "number") geoNear.maxDistance = opts.maxKm * 1000;
      const rows = await model.aggregate([{ $geoNear: geoNear } as any, { $limit: 1 }]).exec();
      const doc = rows[0];
      if (!doc) return null;
      return { climate: strip(doc), distanceKm: (doc.distanceM ?? 0) / 1000 };
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type ClimateYearRepo = ReturnType<typeof makeClimateYearRepo>;
