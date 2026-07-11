import type { Model } from "mongoose";
import { makePlaceRoundupRepo } from "./place-roundup-repo";
import type { iPlaceRoundup, iPlaceRoundupModel } from "./place-roundup-model";

/** A minimal chainable query stub that resolves `.exec()` to `result`. */
const query = (result: unknown) => {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  q.sort = jest.fn(chain);
  q.limit = jest.fn(chain);
  q.lean = jest.fn(chain);
  q.exec = jest.fn(async () => result);
  return q;
};

const base: iPlaceRoundup = {
  placeKind: "country",
  placeId: "gb",
  name: "United Kingdom",
  generatedAt: new Date("2026-07-01T12:00:00.000Z"),
  windowStart: "2026-07-01T00:00:00.000Z",
  windowEnd: "2026-07-01T12:00:00.000Z",
  inputs: { topCities: [], area: null, alerts: [], volcanoes: [], tideGauges: [], seismoStations: [] },
  narrative: "",
  narrativeStatus: "skipped",
};

describe("makePlaceRoundupRepo", () => {
  it("create() persists the round-up and strips mongo internals", async () => {
    const created = { ...base, id: "r1", _id: "abc", __v: 0 };
    const model = {
      create: jest.fn(async () => ({ toObject: () => created })),
    } as unknown as Model<iPlaceRoundupModel>;

    const repo = makePlaceRoundupRepo(model);
    const out = await repo.create(base);
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ placeId: "gb" }));
    expect(out).not.toHaveProperty("_id");
    expect(out).not.toHaveProperty("__v");
    expect(out.id).toBe("r1");
  });

  it("latestForPlace() filters by placeId and sorts generatedAt desc", async () => {
    const doc = { ...base, id: "r2", _id: "x" };
    const findOne = jest.fn(() => query(doc));
    const model = { findOne } as unknown as Model<iPlaceRoundupModel>;

    const repo = makePlaceRoundupRepo(model);
    const out = await repo.latestForPlace("gb");
    expect(findOne).toHaveBeenCalledWith({ placeId: "gb" });
    const q = findOne.mock.results[0].value;
    expect(q.sort).toHaveBeenCalledWith({ generatedAt: -1 });
    expect(out?.id).toBe("r2");
  });

  it("latestForPlace() returns null when nothing matches", async () => {
    const model = { findOne: jest.fn(() => query(null)) } as unknown as Model<iPlaceRoundupModel>;
    const repo = makePlaceRoundupRepo(model);
    expect(await repo.latestForPlace("xx")).toBeNull();
  });

  it("list() scopes to the place and applies the limit", async () => {
    const docs = [{ ...base, id: "r3", _id: "y" }];
    const find = jest.fn(() => query(docs));
    const model = { find } as unknown as Model<iPlaceRoundupModel>;

    const repo = makePlaceRoundupRepo(model);
    const out = await repo.list("gb", { limit: 5 });
    expect(find).toHaveBeenCalledWith({ placeId: "gb" });
    const q = find.mock.results[0].value;
    expect(q.limit).toHaveBeenCalledWith(5);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("r3");
  });

  it("latestPerPlace() aggregates newest-per-place", async () => {
    const docs = [{ ...base, id: "r4", _id: "z" }];
    const aggregate = jest.fn(() => ({ exec: async () => docs }));
    const model = { aggregate } as unknown as Model<iPlaceRoundupModel>;

    const repo = makePlaceRoundupRepo(model);
    const out = await repo.latestPerPlace();
    expect(aggregate).toHaveBeenCalled();
    expect(out[0].id).toBe("r4");
    expect(out[0]).not.toHaveProperty("_id");
  });
});
