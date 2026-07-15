import type { AlertBlobSummary } from "@photonsurge/shared/db/alert-blob-repo";
import type { iCityWeather } from "@photonsurge/shared/db/city-weather-model";
import type { FocusAlertBlob } from "./types";

/**
 * The dissolved warning shapes over a view, each city carrying what the weather
 * is doing there.
 *
 * The split of labour is the point. The worker has already decided which cities
 * sit inside which shape — a point-in-polygon against a polygon that can span
 * several countries, not something to repeat on every cut — and the hourly
 * cityWeather job has already sampled their conditions. So the on-air question
 * "thunderstorm warning over Paris, Milan and Budapest, and it's 31° in Paris"
 * costs two indexed reads and a join in memory.
 *
 * Conditions are joined HERE rather than baked onto the blob because a blob is
 * rebuilt on its own schedule and would otherwise serve yesterday's temperature.
 *
 * Deps are structural (`AppDb` satisfies them) so this stays testable without a
 * database — importing the real db module drags mongoose into the client test
 * environment.
 */
export interface BlobDeps {
  alertBlobs: {
    summariesForBbox(bbox: [number, number, number, number]): Promise<AlertBlobSummary[]>;
  };
  cityWeather: {
    conditionsByCityIds(
      ids: string[],
    ): Promise<Pick<iCityWeather, "cityId" | "current" | "daily">[]>;
  };
}

export async function blobsFor(
  db: BlobDeps,
  bbox: [number, number, number, number],
): Promise<FocusAlertBlob[]> {
  const blobs = await db.alertBlobs.summariesForBbox(bbox);
  if (!blobs.length) return [];

  // One read for every city across every shape — a city under two warnings is
  // asked for once, not twice.
  const ids = [...new Set(blobs.flatMap((b) => b.cities.map((c) => c.id)))];
  const wx = new Map((await db.cityWeather.conditionsByCityIds(ids)).map((w) => [w.cityId, w]));

  return blobs.map((b) => {
    const cities = b.cities.map((c) => {
      const w = wx.get(c.id);
      // Below the cache's 100k floor there simply is no reading — leave the
      // fields off rather than invent a zero a caption would render as 0°C.
      return w ? { ...c, current: w.current, daily: w.daily } : c;
    });
    return { ...b, cities, citiesWithConditions: cities.filter((c) => wx.has(c.id)).length };
  });
}
