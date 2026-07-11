import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { SeismoSeries } from "../seismo/types";
import type { iSeismoSeriesModel } from "./seismo-series-model";

const keyOf = (s: Pick<SeismoSeries, "net" | "sta" | "loc" | "cha">) => `${s.net}.${s.sta}.${s.loc}.${s.cha}`;

const strip = (doc: any): SeismoSeries => ({
  net: doc.net,
  sta: doc.sta,
  loc: doc.loc,
  cha: doc.cha,
  lat: doc.lat,
  lng: doc.lng,
  siteName: doc.siteName ?? undefined,
  sampleRateHz: doc.sampleRateHz,
  samples: (doc.samples ?? []).map((s: any) => ({ t: s.t, v: s.v })),
  latest: doc.latest,
  updatedAt: new Date(doc.updatedAt).getTime(),
});

/** A cached series plus its great-circle distance from the query point. */
export interface NearestSeismoSeries {
  series: SeismoSeries;
  distanceKm: number;
}

/**
 * Live-waveform series persistence + nearby-stations lookup. The worker
 * `upsert`s one doc per streaming channel as SeedLink records decode; the
 * public panel reads `nearMany` for the SET of cached series near the on-air
 * point (plural — it cycles through them and highlights each on the globe),
 * empty when nothing's in range (the panel then hides).
 */
export function makeSeismoSeriesRepo(model: Model<iSeismoSeriesModel>) {
  return {
    model,

    /** Upsert one channel's series on `key`, refreshing samples + geo. */
    async upsert(series: SeismoSeries): Promise<void> {
      const key = keyOf(series);
      await model.updateOne(
        { key },
        {
          $set: {
            net: series.net,
            sta: series.sta,
            loc: series.loc,
            cha: series.cha,
            lat: series.lat,
            lng: series.lng,
            siteName: series.siteName,
            sampleRateHz: series.sampleRateHz,
            samples: series.samples,
            latest: series.latest,
            updatedAt: new Date(series.updatedAt),
            geo: { type: "Point" as const, coordinates: [series.lng, series.lat] as [number, number] },
          },
          $setOnInsert: { id: uuidv4() },
        },
        { upsert: true },
      );
    },

    /** The `limit` cached series nearest `[lng,lat]`, within `maxKm` if given. */
    async nearMany(opts: { lng: number; lat: number; maxKm?: number; limit?: number }): Promise<NearestSeismoSeries[]> {
      const geoNear: Record<string, unknown> = {
        near: { type: "Point", coordinates: [opts.lng, opts.lat] },
        distanceField: "distanceM",
        spherical: true,
      };
      if (typeof opts.maxKm === "number") geoNear.maxDistance = opts.maxKm * 1000;
      const rows = await model
        .aggregate([{ $geoNear: geoNear } as any, { $limit: opts.limit ?? 6 }])
        .exec();
      return rows.map((doc: any) => ({ series: strip(doc), distanceKm: (doc.distanceM ?? 0) / 1000 }));
    },

    /**
     * The station keys that currently have a live cached series — i.e. the
     * stations the worker is actively streaming (near what's on air). Used by the
     * admin content list to show "active only" seismic stations. No samples.
     */
    async activeKeys(): Promise<string[]> {
      const docs = await model.find({}).select({ net: 1, sta: 1, loc: 1, cha: 1, key: 1, _id: 0 }).lean().exec();
      return docs.map((d: any) => d.key || keyOf(d)).filter(Boolean);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type SeismoSeriesRepo = ReturnType<typeof makeSeismoSeriesRepo>;
