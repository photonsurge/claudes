import type { Model } from "mongoose";
import { makeAirLogRepo, type AirCut } from "./air-log-repo";
import type { iAirEntryModel, iAirRunModel } from "./air-log-model";

const T0 = new Date("2026-07-08T10:00:00Z");
const T1 = new Date("2026-07-08T10:00:45Z");

const cut = (over: Partial<AirCut> = {}): AirCut => ({
  runId: "run-1",
  sceneId: "default",
  seq: 1,
  kind: "quake",
  segmentId: "quake:us7000abcd",
  title: "Earthquake",
  subtitle: "M6.1 · Fiji",
  breaking: true,
  timesShown: 1,
  center: [178.1, -17.9],
  zoom: 5,
  holdMs: 45000,
  startedAt: T0,
  ...over,
});

type Mocks = Partial<Record<"find" | "findOne" | "create" | "updateOne", jest.Mock>>;

const chain = (result: unknown) => ({ lean: () => ({ exec: async () => result }) });

function fakeModel<T>(overrides: Mocks = {}) {
  const find = overrides.find ?? jest.fn(() => ({ ...chain([]), sort: () => ({ ...chain([]), limit: () => chain([]) }) }));
  const findOne = overrides.findOne ?? jest.fn(() => chain(null));
  const create = overrides.create ?? jest.fn(async (doc: unknown) => doc);
  const updateOne = overrides.updateOne ?? jest.fn(() => ({ exec: async () => ({}) }));
  return { model: { find, findOne, create, updateOne } as unknown as Model<T>, find, findOne, create, updateOne };
}

describe("makeAirLogRepo", () => {
  it("recordCut closes the previous open entry with the real on-screen time, then opens the new one", async () => {
    const prevOpen = { id: "e-prev", runId: "run-1", startedAt: T0 };
    const entry = fakeModel<iAirEntryModel>({ find: jest.fn(() => chain([prevOpen])) });
    const run = fakeModel<iAirRunModel>();
    const repo = makeAirLogRepo(run.model, entry.model);

    await repo.recordCut(cut({ seq: 2, startedAt: T1 }), "skipped");

    expect(entry.find).toHaveBeenCalledWith({ runId: "run-1", endedAt: null });
    const [filter, update] = entry.updateOne.mock.calls[0];
    expect(filter).toEqual({ id: "e-prev" });
    expect(update.$set).toEqual({ endedAt: T1, actualMs: 45000, endReason: "skipped" });
    expect(entry.create.mock.calls[0][0]).toMatchObject({ seq: 2, kind: "quake", segmentId: "quake:us7000abcd" });
    const [, runUpdate] = run.updateOne.mock.calls[0];
    expect(runUpdate.$inc).toEqual({ cuts: 1, "kindCounts.quake": 1 });
    expect(runUpdate.$set).toEqual({ lastCutAt: T1 });
  });

  it("startRun closes dangling open runs for the scene as stale before opening the new one", async () => {
    const run = fakeModel<iAirRunModel>({ find: jest.fn(() => chain([{ id: "run-old", sceneId: "default" }])) });
    const entry = fakeModel<iAirEntryModel>({ find: jest.fn(() => chain([])) });
    const repo = makeAirLogRepo(run.model, entry.model);

    const id = await repo.startRun("default", T0);

    expect(run.find).toHaveBeenCalledWith({ sceneId: "default", endedAt: null });
    const [filter, update] = run.updateOne.mock.calls[0];
    expect(filter).toEqual({ id: "run-old" });
    expect(update.$set).toEqual({ endedAt: T0, endReason: "stale" });
    expect(run.create.mock.calls[0][0]).toMatchObject({ id, sceneId: "default", startedAt: T0, cuts: 0 });
  });

  it("endRun closes the run's open entry as run-ended and stamps auto-off", async () => {
    const open = { id: "e-last", runId: "run-1", startedAt: T0 };
    const entry = fakeModel<iAirEntryModel>({ find: jest.fn(() => chain([open])) });
    const run = fakeModel<iAirRunModel>();
    const repo = makeAirLogRepo(run.model, entry.model);

    await repo.endRun("run-1", T1);

    const [, entryUpdate] = entry.updateOne.mock.calls[0];
    expect(entryUpdate.$set).toEqual({ endedAt: T1, actualMs: 45000, endReason: "run-ended" });
    const [runFilter, runUpdate] = run.updateOne.mock.calls[0];
    expect(runFilter).toEqual({ id: "run-1" });
    expect(runUpdate.$set).toEqual({ endedAt: T1, endReason: "auto-off" });
  });

  it("listEntries returns the timeline in air order, stripped of Mongo internals", async () => {
    const rows = [
      { _id: "x", __v: 0, id: "e1", runId: "run-1", seq: 1, kind: "intro" },
      { _id: "y", __v: 0, id: "e2", runId: "run-1", seq: 2, kind: "quake" },
    ];
    const sort = jest.fn(() => chain(rows));
    const entry = fakeModel<iAirEntryModel>({ find: jest.fn(() => ({ sort })) });
    const run = fakeModel<iAirRunModel>();
    const repo = makeAirLogRepo(run.model, entry.model);

    const out = await repo.listEntries("run-1");

    expect(sort).toHaveBeenCalledWith({ seq: 1 });
    expect(out).toEqual([
      { id: "e1", runId: "run-1", seq: 1, kind: "intro" },
      { id: "e2", runId: "run-1", seq: 2, kind: "quake" },
    ]);
  });

  it("listRuns applies the scene filter and only caps when a limit is passed", async () => {
    const limit = jest.fn(() => chain([]));
    const sort = jest.fn(() => ({ ...chain([{ _id: "x", __v: 0, id: "r1", sceneId: "default" }]), limit }));
    const run = fakeModel<iAirRunModel>({ find: jest.fn(() => ({ sort })) });
    const entry = fakeModel<iAirEntryModel>();
    const repo = makeAirLogRepo(run.model, entry.model);

    const out = await repo.listRuns({ sceneId: "default" });
    expect(run.find).toHaveBeenCalledWith({ sceneId: "default" });
    expect(sort).toHaveBeenCalledWith({ startedAt: -1 });
    expect(limit).not.toHaveBeenCalled();
    expect(out).toEqual([{ id: "r1", sceneId: "default" }]);

    await repo.listRuns({ limit: 5 });
    expect(limit).toHaveBeenCalledWith(5);
  });

  it("recentEntries returns a scene's shots newest-first, capped (default 12), stripped", async () => {
    const rows = [
      { _id: "x", __v: 0, id: "e2", sceneId: "default", seq: 2, kind: "quake", startedAt: T1 },
      { _id: "y", __v: 0, id: "e1", sceneId: "default", seq: 1, kind: "intro", startedAt: T0 },
    ];
    const limit = jest.fn(() => chain(rows));
    const sort = jest.fn(() => ({ limit }));
    const entry = fakeModel<iAirEntryModel>({ find: jest.fn(() => ({ sort })) });
    const run = fakeModel<iAirRunModel>();
    const repo = makeAirLogRepo(run.model, entry.model);

    const out = await repo.recentEntries({ sceneId: "default" });

    expect(entry.find).toHaveBeenCalledWith({ sceneId: "default" });
    expect(sort).toHaveBeenCalledWith({ startedAt: -1 });
    expect(limit).toHaveBeenCalledWith(12);
    expect(out).toEqual([
      { id: "e2", sceneId: "default", seq: 2, kind: "quake", startedAt: T1 },
      { id: "e1", sceneId: "default", seq: 1, kind: "intro", startedAt: T0 },
    ]);

    await repo.recentEntries({ sceneId: "default", limit: 5 });
    expect(limit).toHaveBeenCalledWith(5);
  });
});
