import { blobsFor } from "./blobs";
import type { AlertBlobSummary } from "@photonsurge/shared/db/alert-blob-repo";

/**
 * The conditions join: the worker has already worked out which cities are under
 * which warning shape, and the hourly cityWeather job has already sampled them.
 * All this does is put the two together — but it must ask for each city ONCE,
 * and it must not invent a reading for the cities the cache doesn't cover.
 */

const summary = (over: Partial<AlertBlobSummary> = {}): AlertBlobSummary => ({
  id: "b1",
  hazard: "thunderstorm",
  severityRank: 3,
  bbox: [14, 49, 24, 55],
  alertCount: 2,
  cityCount: 2,
  cities: [
    { id: "c1", name: "Warsaw", cc: "PL", lat: 52, lng: 21, population: 1_790_658 },
    { id: "c2", name: "Przysucha", cc: "PL", lat: 51.36, lng: 20.63, population: 6_000 },
  ],
  ...over,
});

function mockDb(blobs: AlertBlobSummary[], conditions: any[] = []) {
  const asked: string[][] = [];
  const db = {
    alertBlobs: { summariesForBbox: async () => blobs },
    cityWeather: {
      conditionsByCityIds: async (ids: string[]) => {
        asked.push(ids);
        return conditions;
      },
    },
  } as never;
  return { db, asked };
}

const WARSAW_WX = {
  cityId: "c1",
  current: { temp: 31.2, wind: 4.1, rain: 0 },
  daily: [{ date: "2026-07-15", hi: 32, lo: 19 }],
};

describe("blobsFor", () => {
  it("hangs each city's conditions off the city", async () => {
    const { db } = mockDb([summary()], [WARSAW_WX]);

    const [blob] = await blobsFor(db, [14, 49, 24, 55]);

    expect(blob.cities[0]).toMatchObject({ name: "Warsaw", current: { temp: 31.2 } });
    expect(blob.cities[0].daily?.[0].hi).toBe(32);
  });

  it("leaves a city below the cache floor with no reading, not a zero", async () => {
    // Only cities ≥100k are sampled. A caption must render "no data", never 0°C.
    const { db } = mockDb([summary()], [WARSAW_WX]);

    const [blob] = await blobsFor(db, [14, 49, 24, 55]);

    expect(blob.cities[1].name).toBe("Przysucha");
    expect(blob.cities[1]).not.toHaveProperty("current");
    expect(blob.citiesWithConditions).toBe(1);
  });

  it("asks for a city under two warnings only once", async () => {
    const { db, asked } = mockDb(
      [summary({ id: "b1" }), summary({ id: "b2", hazard: "heat" })],
      [WARSAW_WX],
    );

    await blobsFor(db, [14, 49, 24, 55]);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(["c1", "c2"]);
  });

  it("does not touch the weather cache when nothing is in view", async () => {
    const { db, asked } = mockDb([]);

    expect(await blobsFor(db, [14, 49, 24, 55])).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("still returns the shapes when the weather cache is empty", async () => {
    const { db } = mockDb([summary()], []);

    const [blob] = await blobsFor(db, [14, 49, 24, 55]);

    expect(blob.cities).toHaveLength(2);
    expect(blob.citiesWithConditions).toBe(0);
  });

  it("keeps the summary's hazard and counts intact", async () => {
    const { db } = mockDb([summary({ cityCount: 1150 })], [WARSAW_WX]);

    const [blob] = await blobsFor(db, [14, 49, 24, 55]);

    // cityCount is the whole shape's total, not what's in view — "and N more".
    expect(blob).toMatchObject({ hazard: "thunderstorm", severityRank: 3, alertCount: 2, cityCount: 1150 });
  });
});
