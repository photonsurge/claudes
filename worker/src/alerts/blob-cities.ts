import type { Model } from "mongoose";
import type { iCityModel } from "@photonsurge/shared/db/city-model";
import type { iBlobCity } from "@photonsurge/shared/db/alert-blob-model";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";

/**
 * Resolve which cities stand inside each dissolved warning shape.
 *
 * "Which places are under this warning" is the question every consumer of a blob
 * ends up asking — the on-air caption, the panel, the director picking somewhere
 * to fly to — and answering it means a point-in-polygon against a shape that can
 * span several countries. Doing that per cut, on the broadcast surface, is the
 * cost this whole blob cache exists to avoid, so we answer it once here, at
 * rebuild, and store the answer.
 *
 * Mongo does the geometry, not us: the cities carry a 2dsphere `loc`, so
 * `$geoWithin` is an index lookup rather than a scan, and no clipping library
 * comes near it.
 */

/** A blob we can annotate — the dissolve's output, or anything shaped like it. */
export interface CitiedBlob {
  geometry: AlertGeometry;
  cities?: iBlobCity[];
}

export interface BlobCityStats {
  /** City placements written across all blobs (a city can be in more than one). */
  cities: number;
  /** Blobs that came back with nobody inside — open sea, mountains, a tiny area. */
  empty: number;
  /** Shapes Mongo refused to query; those blobs keep an empty list. */
  failures: number;
}

/**
 * Cities inside one shape, biggest first.
 *
 * The sort is done here rather than in Mongo on purpose. Asking the server to
 * `.sort({ population: -1 })` invites the planner to satisfy it by walking
 * `city_population_ix` end-to-end — the exact 1.2s query the `loc` index was
 * added to kill. So we pin the geo index with a hint, take the (small) matching
 * set, and order it in memory where it costs nothing.
 */
export async function citiesIn(
  model: Model<iCityModel>,
  geometry: AlertGeometry,
): Promise<iBlobCity[]> {
  // A point or a line encloses nobody, and `$geoWithin` rejects both outright.
  if (geometry?.type !== "Polygon" && geometry?.type !== "MultiPolygon") return [];

  const docs = await model
    .find(
      { loc: { $geoWithin: { $geometry: geometry as never } } },
      { _id: 0, id: 1, name: 1, cc: 1, lat: 1, lng: 1, population: 1 },
    )
    .hint("city_geo_ix")
    .lean()
    .exec();

  return (docs as unknown as iBlobCity[])
    .map((c) => ({
      id: c.id,
      name: c.name,
      cc: c.cc,
      lat: c.lat,
      lng: c.lng,
      population: c.population,
    }))
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
}

/**
 * Fill in `cities` on every blob, in place.
 *
 * Sequential, one indexed query per shape: a few hundred blobs is nothing to the
 * worker, and firing them all at once would just contend with the ingest that
 * shares this connection. Every shape is guarded on its own — a geometry Mongo
 * won't accept must cost that blob its city list, not take down a rebuild that
 * has already done all the clipping.
 */
export async function attachCities<T extends CitiedBlob>(
  model: Model<iCityModel>,
  blobs: T[],
): Promise<BlobCityStats> {
  const stats: BlobCityStats = { cities: 0, empty: 0, failures: 0 };

  for (const blob of blobs) {
    try {
      blob.cities = await citiesIn(model, blob.geometry);
    } catch {
      blob.cities = [];
      stats.failures++;
      continue;
    }
    stats.cities += blob.cities.length;
    if (!blob.cities.length) stats.empty++;
  }
  return stats;
}
