import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { TideSeries } from "../tides/types";
import type { iTideSeriesModel } from "./tide-series-model";

const keyOf = (s: Pick<TideSeries, "provider" | "stationId">) => `${s.provider}:${s.stationId}`;

const strip = (doc: any): TideSeries => ({
  stationId: doc.stationId,
  provider: doc.provider,
  name: doc.name,
  lng: doc.lng,
  lat: doc.lat,
  unit: "m",
  samples: (doc.samples ?? []).map((s: any) => ({ t: s.t, v: s.v })),
  latest: doc.latest,
  updatedAt: new Date(doc.updatedAt).getTime(),
});

/** A cached series plus its great-circle distance from the query point. */
export interface NearestSeries {
  series: TideSeries;
  distanceKm: number;
}

/**
 * Recent water-level series persistence + nearest lookup. The worker `upsert`s
 * one doc per near-the-action station each snapshot; the public gauge reads the
 * single `nearest` cached series to the on-air point (or null when none is in
 * range — the gauge then hides).
 */
export function makeTideSeriesRepo(model: Model<iTideSeriesModel>) {
  return {
    model,

    /** Upsert one station's series on `key`, refreshing samples + loc. */
    async upsert(series: TideSeries): Promise<void> {
      const key = keyOf(series);
      await model.updateOne(
        { key },
        {
          $set: {
            stationId: series.stationId,
            provider: series.provider,
            name: series.name,
            lng: series.lng,
            lat: series.lat,
            samples: series.samples,
            latest: series.latest,
            updatedAt: new Date(series.updatedAt),
            loc: { type: "Point" as const, coordinates: [series.lng, series.lat] as [number, number] },
          },
          $setOnInsert: { id: uuidv4() },
        },
        { upsert: true },
      );
    },

    /** Nearest cached series to `[lng,lat]`, within `maxKm` if given, else null. */
    async nearest(opts: {
      lng: number;
      lat: number;
      maxKm?: number;
    }): Promise<NearestSeries | null> {
      const geoNear: Record<string, unknown> = {
        near: { type: "Point", coordinates: [opts.lng, opts.lat] },
        distanceField: "distanceM",
        spherical: true,
      };
      if (typeof opts.maxKm === "number") geoNear.maxDistance = opts.maxKm * 1000;
      const rows = await model.aggregate([{ $geoNear: geoNear } as any, { $limit: 1 }]).exec();
      const doc = rows[0];
      if (!doc) return null;
      return { series: strip(doc), distanceKm: (doc.distanceM ?? 0) / 1000 };
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type TideSeriesRepo = ReturnType<typeof makeTideSeriesRepo>;
