import type { Model } from "mongoose";
import { makeAlertBlobRepo } from "./alert-blob-repo";
import type { iAlertBlobModel, iBlobCity } from "./alert-blob-model";

/**
 * `summariesForBbox` is the read the on-air focus bundle makes on every located
 * cut, so two things matter and are asserted here: the geometry never comes back
 * (it's the whole weight of a blob, and reading-to-drop is how the alerts read
 * became an OOM), and the view/shape overlap is decided in MONGO, not in JS.
 */

const city = (id: string, name: string, lng: number, lat: number, population = 1000): iBlobCity => ({
  id,
  name,
  cc: "PL",
  lat,
  lng,
  population,
});

function mockModel(docs: Partial<iAlertBlobModel>[]) {
  const calls: { filter: any; projection: any }[] = [];
  const model = {
    find: (filter: any, projection: any) => {
      calls.push({ filter, projection });
      const chain = {
        sort: () => chain,
        lean: () => chain,
        exec: async () => docs,
      };
      return chain;
    },
  } as unknown as Model<iAlertBlobModel>;
  return { repo: makeAlertBlobRepo(model), calls };
}

describe("summariesForBbox", () => {
  it("never asks Mongo for the geometry", async () => {
    const { repo, calls } = mockModel([]);

    await repo.summariesForBbox([14, 49, 24, 55]);

    expect(calls[0].projection.geometry).toBeUndefined();
    expect(calls[0].projection).toMatchObject({ id: 1, hazard: 1, cities: 1 });
  });

  it("filters by overlap in the query, not after the read", async () => {
    // If this ever moves into JS, every shape's city list lands in the heap to
    // be thrown away — the thing the projection above is protecting against.
    const { repo, calls } = mockModel([]);

    await repo.summariesForBbox([14, 49, 24, 55]);

    expect(JSON.stringify(calls[0].filter)).toContain("$expr");
  });

  it("summarises a blob without handing back its shape", async () => {
    const { repo } = mockModel([
      {
        id: "b1",
        hazard: "thunderstorm",
        severityRank: 3,
        bbox: [14, 49, 24, 55],
        memberIds: ["a1", "a2", "a3"],
        cities: [city("c1", "Warsaw", 21, 52, 1_790_658)],
        geometry: { type: "Polygon", coordinates: [] } as never,
      },
    ]);

    const [out] = await repo.summariesForBbox([14, 49, 24, 55]);

    expect(out).toEqual({
      id: "b1",
      hazard: "thunderstorm",
      severityRank: 3,
      bbox: [14, 49, 24, 55],
      alertCount: 3,
      cityCount: 1,
      cities: [city("c1", "Warsaw", 21, 52, 1_790_658)],
    });
    expect(out).not.toHaveProperty("geometry");
  });

  it("scopes cities to the view but keeps the shape's true total", async () => {
    // A blob over Europe seen through a Poland camera: name who's on screen,
    // but "and N more" must still count everyone under the warning.
    const { repo } = mockModel([
      {
        id: "b1",
        hazard: "thunderstorm",
        severityRank: 3,
        bbox: [-5, 40, 30, 60],
        memberIds: ["a1"],
        cities: [
          city("c1", "Warsaw", 21, 52),
          city("c2", "Paris", 2.35, 48.85), // outside the view
          city("c3", "Kraków", 19.94, 50.06),
        ],
      },
    ]);

    const [out] = await repo.summariesForBbox([14, 49, 24, 55]);

    expect(out.cities.map((c) => c.name)).toEqual(["Warsaw", "Kraków"]);
    expect(out.cityCount).toBe(3);
  });

  it("splits an antimeridian view in two so a Fiji camera isn't empty", async () => {
    const { repo, calls } = mockModel([
      {
        id: "b1",
        hazard: "wind",
        severityRank: 2,
        bbox: [170, -20, 185, -10],
        memberIds: ["a1"],
        cities: [
          city("c1", "Suva", 178.44, -18.14),
          city("c2", "Nadi", -177.4, -17.8), // the far side of the seam
          city("c3", "Sydney", 151.2, -33.87), // genuinely outside
        ],
      },
    ]);

    // west > east — the camera straddles 180.
    const [out] = await repo.summariesForBbox([170, -20, -175, -10]);

    expect(JSON.stringify(calls[0].filter)).toContain("$or");
    expect(out.cities.map((c) => c.name)).toEqual(["Suva", "Nadi"]);
  });

  it("survives a blob that predates the cities/bbox fields", async () => {
    const { repo } = mockModel([{ id: "b1", hazard: "heat", severityRank: 1 }]);

    const [out] = await repo.summariesForBbox([14, 49, 24, 55]);

    expect(out).toMatchObject({ alertCount: 0, cityCount: 0, cities: [] });
  });
});
