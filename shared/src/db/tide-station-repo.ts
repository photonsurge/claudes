import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { TideStation } from "../tides/types";
import type { iTideStationModel } from "./tide-station-model";

const keyOf = (s: Pick<TideStation, "provider" | "stationId">) => `${s.provider}:${s.stationId}`;

const strip = (doc: any): TideStation => ({
  stationId: doc.stationId,
  provider: doc.provider,
  name: doc.name,
  lng: doc.lng,
  lat: doc.lat,
  country: doc.country ?? undefined,
  sensor: doc.sensor ?? undefined,
});

/** A station plus its great-circle distance from the query point. */
export interface NearestStation {
  station: TideStation;
  distanceKm: number;
}

/**
 * Tide-gauge catalog persistence + nearby-stations lookup. `replace` swaps the
 * whole set on each refresh (upsert on `key`, then prune vanished stations, like
 * the cable repo); `nearMany` uses the `2dsphere` index to find the handful of
 * gauges closest to an event, for the worker's focus-driven snapshot selection.
 */
export function makeTideStationRepo(model: Model<iTideStationModel>) {
  return {
    model,

    /** Replace the cached station set with a fresh catalog snapshot. */
    async replace(stations: TideStation[]): Promise<{ stations: number }> {
      if (!stations.length) return { stations: 0 };
      const fetchedAt = new Date();
      const keys = stations.map(keyOf);
      await model.bulkWrite(
        stations.map((s) => ({
          updateOne: {
            filter: { key: keyOf(s) },
            update: {
              $set: {
                stationId: s.stationId,
                provider: s.provider,
                name: s.name,
                lng: s.lng,
                lat: s.lat,
                country: s.country,
                sensor: s.sensor,
                fetchedAt,
                loc: { type: "Point" as const, coordinates: [s.lng, s.lat] as [number, number] },
              },
              $setOnInsert: { id: uuidv4() },
            },
            upsert: true,
          },
        })),
      );
      await model.deleteMany({ key: { $nin: keys } });
      return { stations: stations.length };
    },

    /** The `limit` stations nearest `[lng,lat]`, within `maxKm` if given. */
    async nearMany(opts: { lng: number; lat: number; maxKm?: number; limit?: number }): Promise<NearestStation[]> {
      const geoNear: Record<string, unknown> = {
        near: { type: "Point", coordinates: [opts.lng, opts.lat] },
        distanceField: "distanceM",
        spherical: true,
      };
      if (typeof opts.maxKm === "number") geoNear.maxDistance = opts.maxKm * 1000;
      const rows = await model
        .aggregate([{ $geoNear: geoNear } as any, { $limit: opts.limit ?? 1 }])
        .exec();
      return rows.map((doc: any) => ({ station: strip(doc), distanceKm: (doc.distanceM ?? 0) / 1000 }));
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type TideStationRepo = ReturnType<typeof makeTideStationRepo>;
