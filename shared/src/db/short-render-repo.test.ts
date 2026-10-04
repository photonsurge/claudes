import mongoose, { type Model } from "mongoose";
import { makeShortRenderRepo } from "./short-render-repo";
import { getShortRenderModel, type iShortRenderModel, type iShortRenderQueueModel } from "./short-render-model";

const lean = (v: unknown) => ({ lean: () => ({ exec: async () => v }) });

describe("makeShortRenderRepo", () => {
  it("creates a queued render with an id and queuedAt, through the strict schema", async () => {
    const created: any[] = [];
    const model = { create: jest.fn(async (doc: any) => created.push(doc)) } as unknown as Model<iShortRenderModel>;
    const repo = makeShortRenderRepo(model, {} as Model<iShortRenderQueueModel>);
    const r = await repo.create({ encoderId: "any", what: { type: "script", scriptId: "s1" }, publishAs: "unlisted", offline: false, batchId: "b" }, 123);
    expect(r).toMatchObject({ encoderId: "any", status: "queued", queuedAt: 123, batchId: "b" });
    expect(r.id).toEqual(expect.any(String));
    // Every field survives the real schema.
    const Real = getShortRenderModel(mongoose.createConnection());
    const doc = new Real({ ...r, video: { title: "x" }, roundup: { maxAgeHours: 14, ifStale: "skip" }, note: "n", assignedEncoderId: "v1", retryOf: "o" }).toObject();
    expect(doc).toMatchObject({ what: { type: "script", scriptId: "s1" }, video: { title: "x" }, roundup: { maxAgeHours: 14, ifStale: "skip" }, assignedEncoderId: "v1", retryOf: "o" });
  });

  it("transition only moves a render still in one of the given statuses", async () => {
    const findOneAndUpdate = jest.fn(() => lean(null));
    const repo = makeShortRenderRepo({ findOneAndUpdate } as unknown as Model<iShortRenderModel>, {} as Model<iShortRenderQueueModel>);
    expect(await repo.transition("r1", ["queued"], { status: "preparing" })).toBeNull();
    expect(findOneAndUpdate).toHaveBeenCalledWith({ id: "r1", status: { $in: ["queued"] } }, { $set: { status: "preparing" } }, { new: true });
  });

  it("drops unknown keys and nulls from the wire shape", async () => {
    const findOne = jest.fn(() => lean({ _id: "x", __v: 0, id: "r1", status: "done", note: null, queuedAt: 1, encoderId: "v", what: {}, publishAs: "public", offline: false }));
    const repo = makeShortRenderRepo({ findOne } as unknown as Model<iShortRenderModel>, {} as Model<iShortRenderQueueModel>);
    expect(await repo.get("r1")).toEqual({ id: "r1", status: "done", queuedAt: 1, encoderId: "v", what: {}, publishAs: "public", offline: false });
  });

  it("keeps the pause switch per encoder", async () => {
    const updateOne = jest.fn(() => ({ exec: async () => ({}) }));
    const find = jest.fn(() => lean([{ encoderId: "v1", paused: true }]));
    const repo = makeShortRenderRepo({} as Model<iShortRenderModel>, { updateOne, find } as unknown as Model<iShortRenderQueueModel>);
    await repo.setPaused("v1", true);
    expect(updateOne).toHaveBeenCalledWith({ encoderId: "v1" }, { $set: { paused: true } }, { upsert: true });
    expect(await repo.pausedEncoders()).toEqual(["v1"]);
  });
});
