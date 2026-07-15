import type { Model } from "mongoose";
import { makeVolcanoRepo, significantVolcanoFilter } from "./volcano-repo";
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

  it("updateUsgsAlert upserts by volcanoId, sets alert fields + bumps fetchedAt, without touching status/firstDate on an existing doc", async () => {
    const updateOne = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({}) }));
    const repo = makeVolcanoRepo({ updateOne } as unknown as Model<iVolcanoModel>);
    const updatedAt = new Date("2026-07-07T19:15:18Z");
    await repo.updateUsgsAlert(
      "gvp:332010",
      { name: "Kilauea", lat: 19.421, lng: -155.287 },
      { usgsAlertLevel: "ADVISORY", usgsColorCode: "YELLOW", usgsUpdatedAt: updatedAt },
    );
    const [filter, update, opts] = updateOne.mock.calls[0] as any[];
    expect(filter).toEqual({ volcanoId: "gvp:332010" });
    expect(update.$set).toMatchObject({ usgsAlertLevel: "ADVISORY", usgsColorCode: "YELLOW", usgsUpdatedAt: updatedAt });
    expect(update.$set.fetchedAt).toBeInstanceOf(Date);
    expect(update.$set.status).toBeUndefined();
    expect(update.$set.firstDate).toBeUndefined();
    expect(update.$setOnInsert).toMatchObject({ name: "Kilauea", lat: 19.421, lng: -155.287, status: "unrest" });
    expect(opts).toEqual({ upsert: true });
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
    const chain: Record<string, jest.Mock> = {};
    chain.sort = jest.fn(() => chain);
    chain.limit = jest.fn(() => chain);
    chain.lean = jest.fn(() => chain);
    chain.exec = exec;
    const find = jest.fn(() => chain);
    const repo = makeVolcanoRepo({ find } as unknown as Model<iVolcanoModel>);
    const [v] = await repo.list();
    expect(v).toMatchObject({ id: "gvp:211060", status: "erupting", statusChangedAt: 1_700_000_000_000 });
  });
});

/**
 * The significance floor is what stops per-volcano jobs scaling with the ~2,647
 * volcano catalog. Pin the shape so a later edit can't quietly widen it back to
 * "every volcano, on a schedule" (the cities enrich-all mistake).
 */
describe("significantVolcanoFilter", () => {
  const NOW = new Date("2026-07-15T00:00:00Z");

  /** Tiny evaluator for the $or/$in/$gt subset this filter uses. */
  const matches = (doc: Record<string, any>): boolean =>
    significantVolcanoFilter(NOW).$or.some((clause: any) => {
      const [field, cond] = Object.entries(clause)[0] as [string, any];
      const v = doc[field];
      if (cond?.$in) return v !== undefined && cond.$in.includes(v);
      if (cond?.$gt) return v !== undefined && v > cond.$gt;
      return false;
    });

  it("includes erupting and unrest volcanoes", () => {
    expect(matches({ status: "erupting" })).toBe(true);
    expect(matches({ status: "unrest" })).toBe(true);
  });

  it("includes elevated USGS alert levels and aviation colours", () => {
    expect(matches({ status: "dormant", usgsAlertLevel: "WARNING" })).toBe(true);
    expect(matches({ status: "dormant", usgsAlertLevel: "WATCH" })).toBe(true);
    expect(matches({ status: "dormant", usgsColorCode: "RED" })).toBe(true);
    expect(matches({ status: "dormant", usgsColorCode: "ORANGE" })).toBe(true);
  });

  it("includes an elevated official (e.g. GeoNet) level", () => {
    expect(matches({ status: "dormant", officialAlertLevelNormalized: "unrest" })).toBe(true);
    expect(matches({ status: "dormant", officialAlertLevelNormalized: "eruption" })).toBe(true);
  });

  it("includes a volcano listed in the current weekly bulletin", () => {
    expect(matches({ status: "dormant", bulletinAt: new Date("2026-07-14T00:00:00Z") })).toBe(true);
  });

  it("EXCLUDES a quiet catalog volcano — the whole point", () => {
    expect(matches({ status: "dormant" })).toBe(false);
    expect(matches({ status: "dormant", usgsAlertLevel: "NORMAL", usgsColorCode: "GREEN" })).toBe(false);
    expect(matches({ status: "dormant", officialAlertLevelNormalized: "normal" })).toBe(false);
  });

  it("EXCLUDES a volcano that dropped out of the bulletin long ago", () => {
    expect(matches({ status: "dormant", bulletinAt: new Date("2026-05-01T00:00:00Z") })).toBe(false);
  });
});

describe("listNeedingEnrichment — the catalog-scaling guard", () => {
  const repoWith = (find: jest.Mock) => makeVolcanoRepo({ find } as unknown as Model<iVolcanoModel>);
  const findMock = () => jest.fn(() => ({ lean: () => ({ exec: async () => [] }) })) as unknown as jest.Mock;

  it("applies the significance floor by DEFAULT (never sweeps dormant volcanoes)", async () => {
    const find = findMock();
    await repoWith(find).listNeedingEnrichment(new Date("2026-06-15T00:00:00Z"));
    const q = (find.mock.calls[0] as any[])[0];
    expect(q.$and).toHaveLength(2); // staleness + significance
    expect(JSON.stringify(q)).toContain("erupting");
  });

  it("force keeps the significance floor (drops only the staleness gate)", async () => {
    const find = findMock();
    await repoWith(find).listNeedingEnrichment(new Date(), true);
    const q = (find.mock.calls[0] as any[])[0];
    expect(q.$and).toHaveLength(1);
    expect(JSON.stringify(q)).toContain("erupting");
    expect(JSON.stringify(q)).not.toContain("wikiFetchedAt");
  });

  it("includeDormant is the explicit escape hatch — the only way to sweep everything", async () => {
    const find = findMock();
    await repoWith(find).listNeedingEnrichment(new Date(), true, { includeDormant: true });
    expect((find.mock.calls[0] as any[])[0]).toEqual({});
  });
});
