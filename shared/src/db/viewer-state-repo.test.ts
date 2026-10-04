import type { Model } from "mongoose";
import { makeViewerStateRepo } from "./viewer-state-repo";
import { ViewerStateSchema, type iViewerState } from "./viewer-state-model";
import { emptyViewerState } from "../viewer";

const makeModel = () => {
  const exec = jest.fn();
  const lean = jest.fn(() => ({ exec }));
  const findOne = jest.fn(() => ({ lean }));
  const find = jest.fn(() => ({ lean }));
  const updateOne = jest.fn(() => ({ exec }));
  return { model: { findOne, find, updateOne } as unknown as Model<iViewerState>, exec, findOne, find, updateOne };
};

describe("viewer state repo", () => {
  it("returns an empty state for a scene never written", async () => {
    const m = makeModel();
    m.exec.mockResolvedValue(null);
    expect(await makeViewerStateRepo(m.model).get("s1")).toEqual(emptyViewerState("s1"));
  });

  it("strips Mongo fields off a stored state", async () => {
    const m = makeModel();
    m.exec.mockResolvedValue({ _id: "x", __v: 0, created: 1, updated: 2, ...emptyViewerState("s1"), audioSeed: 7 });
    expect(await makeViewerStateRepo(m.model).get("s1")).toEqual({ ...emptyViewerState("s1"), audioSeed: 7 });
  });

  it("upserts the whole state", async () => {
    const m = makeModel();
    const state = { ...emptyViewerState("s1"), audioSkipEpoch: 3, updatedAt: 9 };
    await makeViewerStateRepo(m.model).save(state);
    expect(m.updateOne).toHaveBeenCalledWith(
      { sceneId: "s1" },
      { $set: { active: {}, queue: [], audioSkipEpoch: 3, audioSeed: 0, updatedAt: 9 } },
      { upsert: true },
    );
  });

  it("asks only for scenes with a pick on air or waiting", async () => {
    const m = makeModel();
    m.exec.mockResolvedValue([]);
    await makeViewerStateRepo(m.model).withPicks();
    expect(m.find).toHaveBeenCalledWith({
      $or: [{ "queue.0": { $exists: true } }, { "active.audioMode": { $exists: true } }, { "active.theme": { $exists: true } }],
    });
  });

  it("persists every ViewerState field", () => {
    for (const k of Object.keys(emptyViewerState("s"))) expect([k, ViewerStateSchema.path(k) != null]).toEqual([k, true]);
  });
});
