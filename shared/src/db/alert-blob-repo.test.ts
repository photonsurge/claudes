import type { Model } from "mongoose";
import { makeAlertBlobRepo, type AlertBlobInput } from "./alert-blob-repo";
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

function mockModel(docs: Partial<iAlertBlobModel>[] = []) {
  const calls: { filter: any; projection: any }[] = [];
  /** Every write, in the order it happened — the ordering is the safety property. */
  const writes: (
    | { op: "insertMany"; docs: any[] }
    | { op: "deleteMany"; filter: any }
    | { op: "updateMany"; filter: any; update: any }
  )[] = [];
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
    insertMany: async (batch: any[]) => {
      writes.push({ op: "insertMany", docs: batch });
      return batch;
    },
    updateMany: async (filter: any, update: any) => {
      writes.push({ op: "updateMany", filter, update });
      return { modifiedCount: 3 };
    },
    deleteMany: async (filter: any) => {
      writes.push({ op: "deleteMany", filter });
      return { deletedCount: 7 };
    },
  } as unknown as Model<iAlertBlobModel>;
  return { repo: makeAlertBlobRepo(model), calls, writes };
}

const blob = (hazard: string): AlertBlobInput => ({
  hazard,
  severityRank: 3 as never,
  geometry: { type: "Polygon", coordinates: [] } as never,
  bbox: [0, 0, 1, 1],
  memberIds: ["a1"],
});

/**
 * A rebuild writes each hazard's shapes as it finishes them and retires the
 * previous generation only at the very end. Both halves matter: streaming is what
 * keeps the job inside its share of the heap, and the late drop is what stops a
 * reader polling mid-rebuild seeing a half-empty globe.
 */
describe("generations", () => {
  it("tags every shape in an instalment with the rebuild it belongs to", async () => {
    const { repo, writes } = mockModel();
    const builtAt = new Date("2026-07-16T09:00:00Z");

    const n = await repo.addGeneration([blob("heat"), blob("wind")], builtAt);

    expect(n).toBe(2);
    const w = writes[0] as { op: "insertMany"; docs: any[] };
    expect(w.docs.map((d) => d.builtAt)).toEqual([builtAt, builtAt]);
    expect(w.docs.map((d) => d.hazard)).toEqual(["heat", "wind"]);
  });

  it("gives every shape its own id", async () => {
    // A blob IS its geometry and has no stable identity across rebuilds, so ids
    // are minted here rather than carried in.
    const { repo, writes } = mockModel();

    await repo.addGeneration([blob("heat"), blob("heat")], new Date());

    const ids = (writes[0] as { docs: any[] }).docs.map((d) => d.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toEqual(expect.any(String));
  });

  it("writes nothing for a hazard that dissolved to no shapes", async () => {
    const { repo, writes } = mockModel();

    expect(await repo.addGeneration([], new Date())).toBe(0);
    expect(writes).toEqual([]);
  });

  it("retires only shapes older than this rebuild", async () => {
    // `$lt`, never `$lte` — the instalments already written carry this exact
    // builtAt, and a drop that included them would wipe the new generation.
    const { repo, writes } = mockModel();
    const builtAt = new Date("2026-07-16T09:00:00Z");

    const r = await repo.dropOlderThan(builtAt);

    expect(r).toEqual({ removed: 7 });
    expect(writes[0]).toEqual({ op: "deleteMany", filter: { builtAt: { $lt: builtAt } } });
  });

  it("writes, then puts live, then drops the old — in that order", async () => {
    // Reversed, the globe empties for the length of a rebuild. And the flip has
    // to come BEFORE the drop, or there's an instant with no live generation at
    // all.
    const { repo, writes } = mockModel();

    await repo.replace([blob("heat")]);

    expect(writes.map((w) => w.op)).toEqual(["insertMany", "updateMany", "deleteMany"]);
  });

  /**
   * A rebuild takes ~2 minutes and can't be atomic, so two generations exist at
   * once and a reader must see exactly one of them. Everything lands `live:
   * false` and is flipped only once the whole set has arrived.
   *
   * Before this, shapes went on air as they landed and the previous generation
   * was retired at the very end — so a job killed mid-rebuild left BOTH sets live
   * forever and the globe drew every shape twice, stacked on itself. Live: 3,871
   * stale shapes under 602 new ones, showing up as pairs of identical
   * overlapping warnings with matching member counts (66 + 66). It looks exactly
   * like a geometry bug.
   */
  describe("a generation is invisible until it is complete", () => {
    it("writes every shape dark", async () => {
      const { repo, writes } = mockModel();

      await repo.addGeneration([blob("heat"), blob("wind")], new Date());

      const w = writes[0] as { docs: any[] };
      expect(w.docs.every((d) => d.live === false)).toBe(true);
    });

    it("puts exactly the committed generation on air", async () => {
      const { repo, writes } = mockModel();
      const builtAt = new Date("2026-07-16T09:00:00Z");

      await repo.commitGeneration(builtAt);

      const up = writes.find((w) => w.op === "updateMany") as any;
      expect(up.filter).toEqual({ builtAt });
      expect(up.update).toEqual({ $set: { live: true } });
    });

    it("flips live BEFORE sweeping, so the globe is never empty", async () => {
      const { repo, writes } = mockModel();

      await repo.commitGeneration(new Date());

      expect(writes.map((w) => w.op)).toEqual(["updateMany", "deleteMany"]);
    });

    it("reports what it swept, so a dead previous rebuild is visible", async () => {
      // Steady state is 0. A spike means the last rebuild never committed.
      const { repo } = mockModel();

      expect(await repo.commitGeneration(new Date())).toEqual({ live: 3, removed: 7 });
    });

    it("reads ONLY the live generation", async () => {
      // Without this filter every read returns every generation in the
      // collection and the globe draws each shape once per generation.
      const { repo, calls } = mockModel([]);

      await repo.list();

      expect(calls[0].filter).toEqual({ live: true });
    });

    it("scopes the camera read to the live generation too", async () => {
      const { repo, calls } = mockModel([]);

      await repo.summariesForBbox([14, 49, 24, 55]);

      expect(calls[0].filter).toMatchObject({ live: true });
    });
  });

  it("still clears the old generation when a rebuild finds no alerts at all", async () => {
    // Nothing to insert, but the shapes on screen have genuinely expired — so the
    // commit still runs and sweeps them. (The flip matches nothing; the drop is
    // what empties the globe, correctly.)
    const { repo, writes } = mockModel();

    expect(await repo.replace([])).toEqual({ blobs: 0 });
    expect(writes.map((w) => w.op)).toEqual(["updateMany", "deleteMany"]);
  });
});

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
