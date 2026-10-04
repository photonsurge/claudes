import mongoose, { type Model } from "mongoose";
import { makeShortScheduleRepo } from "./short-schedule-repo";
import { getShortScheduleModel, type iShortScheduleModel } from "./short-schedule-model";
import { defaultShortSchedule, type ShortSchedule } from "../short-schedule";

const lean = (v: unknown) => ({ lean: () => ({ exec: async () => v }) });
const chain = (v: unknown) => ({ sort: () => ({ lean: () => ({ exec: async () => v }) }) });

const morning: ShortSchedule = {
  ...defaultShortSchedule("", "Morning batch"),
  enabled: true,
  encoderId: "obs-v1",
  accountId: "UC1",
  nextAt: 1000,
  videos: [
    { formatId: "europe", what: { type: "template", scope: { type: "area", id: "europe" } }, roundup: { maxAgeHours: 14, ifStale: "refresh" }, video: { publishAs: "public" } },
    { formatId: "uk", what: { type: "template", scope: { type: "auto", of: "country" } }, roundup: { maxAgeHours: 14, ifStale: "skip" }, skipIfQuiet: true },
  ],
};

describe("makeShortScheduleRepo", () => {
  it("creates a schedule with an id; every field survives the real schema", async () => {
    const created: any[] = [];
    const model = { create: jest.fn(async (doc: any) => created.push(doc)) } as unknown as Model<iShortScheduleModel>;
    const repo = makeShortScheduleRepo(model);
    const { id: _drop, ...input } = morning;
    const s = await repo.create(input);
    expect(s.id).toEqual(expect.any(String));
    expect(created[0]).toEqual(s);
    const Real = getShortScheduleModel(mongoose.createConnection());
    const doc = new Real({ ...s, lastFire: { at: 5, batchId: "b", outcome: "queued" } }).toObject();
    expect(doc).toMatchObject({ ...s, lastFire: { at: 5, batchId: "b", outcome: "queued" } });
    expect(new Real(s).validateSync()).toBeUndefined();
  });

  it("reads back through the sanitiser: unknown keys and junk drop, server fields are kept", async () => {
    const findOne = jest.fn(() =>
      lean({ _id: "x", __v: 0, createdAt: new Date(), ...morning, id: "s1", fireCount: 4, lastFire: { at: 9, outcome: "missed" }, videos: [...morning.videos, { junk: true }] }),
    );
    const repo = makeShortScheduleRepo({ findOne } as unknown as Model<iShortScheduleModel>);
    expect(await repo.get("s1")).toEqual({ ...morning, id: "s1", fireCount: 4, lastFire: { at: 9, outcome: "missed" } });
  });

  it("due: enabled schedules with nextAt <= now, earliest first", async () => {
    const find = jest.fn(() => chain([]));
    const repo = makeShortScheduleRepo({ find } as unknown as Model<iShortScheduleModel>);
    await repo.due(5000);
    expect(find).toHaveBeenCalledWith({ enabled: true, nextAt: { $ne: null, $lte: 5000 } });
  });

  it("claimFire only takes the fire it read (enabled, same nextAt), counting it when asked", async () => {
    const findOneAndUpdate = jest.fn(() => lean(null));
    const repo = makeShortScheduleRepo({ findOneAndUpdate } as unknown as Model<iShortScheduleModel>);
    expect(await repo.claimFire("s1", 1000, { nextAt: 2000 }, true)).toBeNull();
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { id: "s1", enabled: true, nextAt: 1000 },
      { $set: { nextAt: 2000 }, $inc: { fireCount: 1 } },
      { new: true },
    );
    await repo.claimFire("s1", 1000, { nextAt: 2000 }, false);
    expect(findOneAndUpdate).toHaveBeenLastCalledWith({ id: "s1", enabled: true, nextAt: 1000 }, { $set: { nextAt: 2000 } }, { new: true });
  });

  it("countFire counts a Run batch now without touching nextAt", async () => {
    const findOneAndUpdate = jest.fn(() => lean({ ...morning, id: "s1", fireCount: 3 }));
    const repo = makeShortScheduleRepo({ findOneAndUpdate } as unknown as Model<iShortScheduleModel>);
    const s = await repo.countFire("s1", { at: 7, batchId: "b", outcome: "queued" });
    expect(s?.fireCount).toBe(3);
    expect(findOneAndUpdate).toHaveBeenCalledWith({ id: "s1" }, { $inc: { fireCount: 1 }, $set: { lastFire: { at: 7, batchId: "b", outcome: "queued" } } }, { new: true });
  });

  it("save sets every field and unsets a cleared account; countByFormat looks inside the batch", async () => {
    const findOneAndUpdate = jest.fn(() => lean({ ...morning, id: "s1" }));
    const countDocuments = jest.fn(() => ({ exec: async () => 2 }));
    const repo = makeShortScheduleRepo({ findOneAndUpdate, countDocuments } as unknown as Model<iShortScheduleModel>);
    const { accountId: _a, ...noAccount } = { ...morning, id: "s1" };
    await repo.save(noAccount as ShortSchedule);
    const [, update] = findOneAndUpdate.mock.calls[0] as unknown as [unknown, any];
    expect(update.$unset).toEqual({ accountId: 1, lastFire: 1 });
    expect(update.$set).not.toHaveProperty("id");
    expect(update.$set).toMatchObject({ name: "Morning batch", videos: morning.videos });
    expect(await repo.countByFormat("uk")).toBe(2);
    expect(countDocuments).toHaveBeenCalledWith({ "videos.formatId": "uk" });
  });
});
