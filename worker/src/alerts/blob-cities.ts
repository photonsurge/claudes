import type { Model } from "mongoose";
import type { iCityModel } from "@photonsurge/shared/db/city-model";
import type { iBlobCity } from "@photonsurge/shared/db/alert-blob-model";
import type { AlertGeometry, iAlertModel } from "@photonsurge/shared/db/alert-model";

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
  /** The alerts that fused into the shape — the fallback's way back to valid polygons. */
  memberIds: string[];
  cities?: iBlobCity[];
}

/** The collections the lookup needs. Injected so this stays testable. */
export interface BlobCityDeps {
  cities: Model<iCityModel>;
  alerts: Model<iAlertModel>;
}

export interface BlobCityStats {
  /** City placements written across all blobs (a city can be in more than one). */
  cities: number;
  /** Blobs that came back with nobody inside — open sea, mountains, a tiny area. */
  empty: number;
  /** Blobs answered from their member areas because the union's shape was unusable. */
  repaired: number;
  /** Blobs no route could answer; those keep an empty list. */
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

const byPopulation = (a: iBlobCity, b: iBlobCity) => (b.population ?? 0) - (a.population ?? 0);

/**
 * Cities under a blob's MEMBER areas, asked one county at a time.
 *
 * The fallback for a dissolved shape Mongo won't accept. polygon-clipping
 * sometimes leaves a self-intersecting ring on real-world borders, and S2 rejects
 * the result outright ("Loop is not valid") — and it does that to precisely the
 * shapes worth having, because the more counties fuse, the more chances to
 * produce a bad ring. Left alone, the five biggest blobs in the system (390, 190,
 * 180, 150, 110 alerts) all listed nobody.
 *
 * But the shape is the only broken thing: the member areas it was built FROM are
 * ordinary county polygons that Mongo already indexes in the alerts collection.
 * So ask them individually and union the answers by city id — the same set the
 * dissolved shape would have returned, minus the geometry it can't express. It
 * costs one query per member instead of one per blob, which is why it's the
 * fallback and not the road.
 */
async function citiesInMembers(deps: BlobCityDeps, memberIds: string[]): Promise<iBlobCity[]> {
  if (!memberIds.length) return [];
  const alerts = (await deps.alerts
    .find({ id: { $in: memberIds } }, { _id: 0, "info.area.geometry": 1 })
    .lean()
    .exec()) as unknown as iAlertModel[];

  const geoms = alerts.flatMap((a) =>
    (a.info ?? []).flatMap((i) =>
      (i.area ?? []).map((ar) => ar.geometry).filter(Boolean),
    ),
  ) as AlertGeometry[];

  const found = new Map<string, iBlobCity>();
  for (const g of geoms) {
    try {
      for (const c of await citiesIn(deps.cities, g)) found.set(c.id, c);
    } catch {
      // One bad county must not cost the blob the other 392.
    }
  }
  return [...found.values()].sort(byPopulation);
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
  deps: BlobCityDeps,
  blobs: T[],
): Promise<BlobCityStats> {
  const stats: BlobCityStats = { cities: 0, empty: 0, repaired: 0, failures: 0 };

  for (const blob of blobs) {
    try {
      blob.cities = await citiesIn(deps.cities, blob.geometry);
    } catch {
      // The dissolved shape is unusable — go back to the areas it came from.
      try {
        blob.cities = await citiesInMembers(deps, blob.memberIds);
        stats.repaired++;
      } catch {
        blob.cities = [];
        stats.failures++;
        continue;
      }
    }
    stats.cities += blob.cities.length;
    if (!blob.cities.length) stats.empty++;
  }
  return stats;
}
