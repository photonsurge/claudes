import type { Model } from "mongoose";
import { makeEventSummaryRepo } from "./event-summary-repo";
import type { iEventSummary, iEventSummaryModel } from "./event-summary-model";

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

const baseSummary: iEventSummary = {
  period: "hourly",
  windowStart: "2026-07-01T11:00:00.000Z",
  windowEnd: "2026-07-01T12:00:00.000Z",
  generatedAt: new Date("2026-07-01T12:00:00.000Z"),
  stats: {
    alertsActive: 0,
    alertsBySeverity: {},
    alertsByHazard: {},
    alertsBySource: {},
    quakeCount: 0,
    quakeMaxMag: 0,
    cyclones: 0,
    tracksNotable: 0,
  },
  hotspots: [],
  topEvents: [],
  narrative: "",
  narrativeStatus: "skipped",
  sources: [],
};

describe("makeEventSummaryRepo", () => {
  it("create() persists the summary and strips mongo internals", async () => {
    const created = { ...baseSummary, id: "s1", _id: "abc", __v: 0 };
    const model = {
      create: jest.fn(async () => ({ toObject: () => created })),
    } as unknown as Model<iEventSummaryModel>;

    const repo = makeEventSummaryRepo(model);
    const out = await repo.create(baseSummary);
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ period: "hourly" }));
    expect(out).not.toHaveProperty("_id");
    expect(out).not.toHaveProperty("__v");
    expect(out.id).toBe("s1");
  });

  it("latest() filters by period and sorts generatedAt desc", async () => {
    const doc = { ...baseSummary, id: "s2", _id: "x" };
    const findOne = jest.fn(() => query(doc));
    const model = { findOne } as unknown as Model<iEventSummaryModel>;

    const repo = makeEventSummaryRepo(model);
    const out = await repo.latest("daily");
    expect(findOne).toHaveBeenCalledWith({ period: "daily" });
    const q = findOne.mock.results[0].value;
    expect(q.sort).toHaveBeenCalledWith({ generatedAt: -1 });
    expect(out?.id).toBe("s2");
  });

  it("latest() returns null when nothing matches", async () => {
    const model = { findOne: jest.fn(() => query(null)) } as unknown as Model<iEventSummaryModel>;
    const repo = makeEventSummaryRepo(model);
    expect(await repo.latest("hourly")).toBeNull();
  });

  it("list() applies the period filter and limit", async () => {
    const docs = [{ ...baseSummary, id: "s3", _id: "y" }];
    const find = jest.fn(() => query(docs));
    const model = { find } as unknown as Model<iEventSummaryModel>;

    const repo = makeEventSummaryRepo(model);
    const out = await repo.list({ period: "12h", limit: 5 });
    expect(find).toHaveBeenCalledWith({ period: "12h" });
    const q = find.mock.results[0].value;
    expect(q.sort).toHaveBeenCalledWith({ generatedAt: -1 });
    expect(q.limit).toHaveBeenCalledWith(5);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("s3");
  });
});
