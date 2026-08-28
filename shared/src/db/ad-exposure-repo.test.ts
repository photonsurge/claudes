import type { Model } from "mongoose";
import { makeAdExposureRepo } from "./ad-exposure-repo";
import type { iAdExposureModel } from "./ad-exposure-model";

const NOW = new Date("2026-08-28T12:00:00Z");
const MIN = 60_000;

/** A stored window doc as `.lean()` hands it back. */
const winDoc = (over: Partial<iAdExposureModel> = {}): any => ({
  id: "w1",
  adId: "ad-1",
  sceneId: "default",
  surface: "ticker",
  startedAt: new Date(NOW.getTime() - 60 * MIN),
  lastSeenAt: new Date(NOW.getTime() - MIN),
  ...over,
});

const chainOf = (result: unknown) => {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.sort = jest.fn(() => chain);
  chain.lean = jest.fn(() => chain);
  chain.exec = jest.fn(async () => result);
  return chain;
};

const repoWith = (model: Record<string, unknown>) =>
  makeAdExposureRepo(model as unknown as Model<iAdExposureModel>);

describe("makeAdExposureRepo.reconcile", () => {
  const modelWith = (docs: unknown[]) => ({
    find: jest.fn(() => chainOf(docs)),
    updateOne: jest.fn(() => ({ exec: jest.fn(async () => ({})) })),
    updateMany: jest.fn(() => ({ exec: jest.fn(async () => ({})) })),
    insertMany: jest.fn(async () => []),
  });

  it("opens a window for a newly-airing pair", async () => {
    const model = modelWith([]);
    const res = await repoWith(model).reconcile("ticker", [{ adId: "ad-1", sceneId: "default" }], NOW, 3 * MIN);
    expect(res).toEqual({ opened: 1, closed: 0, touched: 0 });
    expect(model.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        adId: "ad-1",
        sceneId: "default",
        surface: "ticker",
        startedAt: NOW,
        lastSeenAt: NOW,
      }),
    ]);
    // Only open (endedAt unset) windows feed the planner.
    expect(model.find).toHaveBeenCalledWith({ surface: "ticker", endedAt: null });
  });

  it("heartbeats a window that keeps airing and closes one that stopped", async () => {
    const model = modelWith([winDoc(), winDoc({ id: "w2", adId: "ad-2" })]);
    const res = await repoWith(model).reconcile("ticker", [{ adId: "ad-1", sceneId: "default" }], NOW, 3 * MIN);
    expect(res).toEqual({ opened: 0, closed: 1, touched: 1 });
    expect(model.updateOne).toHaveBeenCalledWith({ id: "w2" }, { $set: { endedAt: NOW } });
    expect(model.updateMany).toHaveBeenCalledWith({ id: { $in: ["w1"] } }, { $set: { lastSeenAt: NOW } });
  });
});

describe("makeAdExposureRepo reads", () => {
  it("listForAd maps windows newest-first with open windows measured to now", async () => {
    const open = winDoc({ id: "w2", startedAt: new Date(NOW.getTime() - 10 * MIN), endedAt: undefined });
    const closed = winDoc({
      id: "w1",
      sceneId: "storm",
      startedAt: new Date(NOW.getTime() - 120 * MIN),
      endedAt: new Date(NOW.getTime() - 90 * MIN),
    });
    const model = { find: jest.fn(() => chainOf([open, closed])) };
    const rows = await repoWith(model).listForAd("ad-1", "ticker", NOW);
    expect(rows).toEqual([
      { sceneId: "default", startedAt: open.startedAt.getTime(), endedAt: undefined, ms: 10 * MIN },
      { sceneId: "storm", startedAt: closed.startedAt.getTime(), endedAt: closed.endedAt.getTime(), ms: 30 * MIN },
    ]);
  });

  it("totalsByAd sums per ad and flags currently-live scenes", async () => {
    const docs = [
      winDoc({ id: "w1", startedAt: new Date(NOW.getTime() - 30 * MIN), endedAt: undefined }),
      winDoc({
        id: "w2",
        sceneId: "storm",
        startedAt: new Date(NOW.getTime() - 100 * MIN),
        endedAt: new Date(NOW.getTime() - 40 * MIN),
      }),
      winDoc({ id: "w3", adId: "ad-2", startedAt: new Date(NOW.getTime() - 5 * MIN), endedAt: undefined }),
    ];
    const model = { find: jest.fn(() => chainOf(docs)) };
    const totals = await repoWith(model).totalsByAd("ticker", NOW);
    expect(totals["ad-1"]).toEqual({ ms: 90 * MIN, liveScenes: ["default"] });
    expect(totals["ad-2"]).toEqual({ ms: 5 * MIN, liveScenes: ["default"] });
  });
});
