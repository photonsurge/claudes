import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { SeismoStation } from "../seismo/types";
import type { iSeismoStationModel } from "./seismo-station-model";

const keyOf = (s: Pick<SeismoStation, "net" | "sta" | "loc" | "cha">) => `${s.net}.${s.sta}.${s.loc}.${s.cha}`;

const strip = (doc: any): SeismoStation => ({
  net: doc.net,
  sta: doc.sta,
  loc: doc.loc,
  cha: doc.cha,
  lat: doc.lat,
  lng: doc.lng,
  elevation: doc.elevation ?? undefined,
  siteName: doc.siteName ?? undefined,
});

/** A station plus its great-circle distance from the query point. */
export interface NearestSeismoStation {
  station: SeismoStation;
  distanceKm: number;
}

/**
 * GSN station catalog persistence + nearest-stations lookup. `replace` swaps
 * the whole set on each refresh (upsert on `key`, then prune vanished
 * stations, like the tide-station repo); `nearMany` finds the handful of
 * stations closest to an event, for the worker's SeedLink focus selection.
 */
export function makeSeismoStationRepo(model: Model<iSeismoStationModel>) {
  return {
    model,

    /** Replace the cached station set with a fresh catalog snapshot. */
    async replace(stations: SeismoStation[]): Promise<{ stations: number }> {
      if (!stations.length) return { stations: 0 };
      const fetchedAt = new Date();
      const keys = stations.map(keyOf);
      await model.bulkWrite(
        stations.map((s) => ({
          updateOne: {
            filter: { key: keyOf(s) },
            update: {
              $set: {
                net: s.net,
                sta: s.sta,
                loc: s.loc,
                cha: s.cha,
                lat: s.lat,
                lng: s.lng,
                elevation: s.elevation,
                siteName: s.siteName,
                fetchedAt,
                geo: { type: "Point" as const, coordinates: [s.lng, s.lat] as [number, number] },
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
    async nearMany(opts: { lng: number; lat: number; maxKm?: number; limit?: number }): Promise<NearestSeismoStation[]> {
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

export type SeismoStationRepo = ReturnType<typeof makeSeismoStationRepo>;
