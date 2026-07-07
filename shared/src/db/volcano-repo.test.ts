import type { Model } from "mongoose";
import { makeVolcanoRepo } from "./volcano-repo";
import type { iVolcanoModel } from "./volcano-model";
import type { Volcano } from "../volcanoes/types";

const volcano: Volcano = {
  id: "gvp:211060",
  name: "Etna",
  country: "Italy",
  lat: 37.75,
  lng: 15.0,
  status: "erupting",
  firstDate: 1_700_000_000_000,
  lastDate: 1_700_000_000_000,
  statusChangedAt: 1_700_000_000_000,
  sourceUrl: "https://volcano.si.edu/volcano.cfm?vn=211060",
};

describe("makeVolcanoRepo", () => {
  it("upsertMany filters on volcanoId and fills loc from lng/lat", async () => {
    const bulkWrite = jest.fn(async () => ({ upsertedCount: 1, matchedCount: 0 }));
    const repo = makeVolcanoRepo({ bulkWrite } as unknown as Model<iVolcanoModel>);
    await repo.upsertMany([volcano]);
    const [ops] = bulkWrite.mock.calls[0] as any[];
    expect(ops).toHaveLength(1);
    const { filter, update, upsert } = ops[0].updateOne;
    expect(filter).toEqual({ volcanoId: "gvp:211060" });
    expect(upsert).toBe(true);
    // Aggregation-pipeline update (array), not a plain $set/$setOnInsert object.
    expect(Array.isArray(update)).toBe(true);
    const set = update[0].$set;
    expect(set.status).toBe("erupting");
    expect(set.loc).toEqual({ type: "Point", coordinates: [15.0, 37.75] });
  });

  it("firstDate keeps the existing value via $ifNull instead of overwriting it", async () => {
    const bulkWrite = jest.fn(async () => ({ upsertedCount: 0, matchedCount: 1 }));
    const repo = makeVolcanoRepo({ bulkWrite } as unknown as Model<iVolcanoModel>);
    await repo.upsertMany([volcano]);
    const [ops] = bulkWrite.mock.calls[0] as any[];
    const set = ops[0].updateOne.update[0].$set;
    expect(set.firstDate).toEqual({ $ifNull: ["$firstDate", new Date(volcano.firstDate)] });
  });

  it("statusChangedAt only advances when the stored status differs from the incoming one", async () => {
    const bulkWrite = jest.fn(async () => ({ upsertedCount: 0, matchedCount: 1 }));
    const repo = makeVolcanoRepo({ bulkWrite } as unknown as Model<iVolcanoModel>);
    await repo.upsertMany([volcano]);
    const [ops] = bulkWrite.mock.calls[0] as any[];
    const cond = ops[0].updateOne.update[0].$set.statusChangedAt.$cond;
    // Same status as stored → keep the existing statusChangedAt (fall back to
    // fetchedAt only if it was never set); different/new → bump to fetchedAt.
    expect(cond[0]).toEqual({ $eq: ["$status", "erupting"] });
    expect(cond[1]).toEqual({ $ifNull: ["$statusChangedAt", expect.any(Date)] });
    expect(cond[2]).toBeInstanceOf(Date);
  });

  it("upsertMany is a no-op for an empty batch", async () => {
    const bulkWrite = jest.fn();
    const repo = makeVolcanoRepo({ bulkWrite } as unknown as Model<iVolcanoModel>);
    const res = await repo.upsertMany([]);
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(res).toEqual({ upserted: 0, matched: 0 });
  });

  it("list() strips docs back to the Volcano domain shape, including statusChangedAt", async () => {
    const doc = {
      volcanoId: "gvp:211060",
      name: "Etna",
      country: "Italy",
      lat: 37.75,
      lng: 15.0,
      status: "erupting",
      firstDate: new Date(1_700_000_000_000),
      lastDate: new Date(1_700_000_000_000),
      statusChangedAt: new Date(1_700_000_000_000),
    };
    const exec = jest.fn(async () => [doc]);
    const chain = { sort: jest.fn(() => chain), limit: jest.fn(() => chain), lean: jest.fn(() => chain), exec };
    const find = jest.fn(() => chain);
    const repo = makeVolcanoRepo({ find } as unknown as Model<iVolcanoModel>);
    const [v] = await repo.list();
    expect(v).toMatchObject({ id: "gvp:211060", status: "erupting", statusChangedAt: 1_700_000_000_000 });
  });
});
