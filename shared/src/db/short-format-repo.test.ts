import mongoose, { type Model } from "mongoose";
import { makeShortFormatRepo } from "./short-format-repo";
import { getShortFormatModel, type iShortFormatModel } from "./short-format-model";
import { defaultShortFormat, type ShortFormat } from "../short-format";

/** Every field, optional ones included, so the round-trip proves none is dropped. */
const full: ShortFormat = {
  id: "short-uk",
  name: "UK round-up",
  template: {
    scope: { type: "country", id: "uk" },
    include: { alerts: true, quakes: false, volcanoes: true },
    budgetMs: 90_000,
    openWithWorld: true,
  },
  opener: { leadWithRoundup: false, roundupDepth: "summary", tour: false, minTourDwellMs: 10_000, budgetShare: 0.5 },
  close: { enabled: false, ms: 4_000 },
  video: {
    title: "%{place} today · %A",
    description: "%{roundup}",
    timezone: "place",
    thumbnail: { source: "frame", atMs: 12_000 },
    tags: ["weather", "uk"],
    categoryId: "28",
    playlistId: "PL123",
    publishAs: "public",
    chapters: false,
  },
  timing: { leadInMs: 2_000, leadOutMs: 8_000 },
  render: { encoderId: "obs-2", accountId: "UC1" },
  layout: "landscape",
};

/** What Mongo would store for `$set` on insert, cast through the REAL strict
 *  schema (an unopened connection — no server needed). */
function throughSchema(set: Record<string, unknown>, id: string) {
  const Real = getShortFormatModel(mongoose.createConnection());
  return new Real({ ...set, id }).toObject({ versionKey: false });
}

function fakeModel(overrides: Partial<Record<"updateOne" | "findOne" | "find" | "deleteOne", jest.Mock>> = {}) {
  let stored: unknown = null;
  const updateOne =
    overrides.updateOne ??
    jest.fn((filter: { id: string }, update: { $set: Record<string, unknown> }) => {
      stored = throughSchema(update.$set, filter.id);
      return { exec: async () => ({ matchedCount: 1 }) };
    });
  const findOne = overrides.findOne ?? jest.fn(() => ({ lean: () => ({ exec: async () => stored }) }));
  const find =
    overrides.find ?? jest.fn(() => ({ sort: () => ({ lean: () => ({ exec: async () => (stored ? [stored] : []) }) }) }));
  const deleteOne = overrides.deleteOne ?? jest.fn(() => ({ exec: async () => ({ deletedCount: 1 }) }));
  return { updateOne, findOne, find, deleteOne } as unknown as Model<iShortFormatModel>;
}

describe("makeShortFormatRepo", () => {
  it("round-trips a fully populated format through the strict schema with no field dropped", async () => {
    const repo = makeShortFormatRepo(fakeModel());
    expect(await repo.upsert(full)).toEqual(full);
    expect(await repo.get("short-uk")).toEqual(full);
  });

  it("round-trips the defaults (no scope, image thumbnail, no render defaults)", async () => {
    const repo = makeShortFormatRepo(fakeModel());
    const d = defaultShortFormat();
    expect(await repo.upsert(d)).toEqual(d);
  });

  it("reads an old doc missing newer settings back with their defaults", async () => {
    const old = { id: "short-x", name: "X", template: { include: { alerts: false, quakes: false, volcanoes: false }, budgetMs: 60_000 } };
    const repo = makeShortFormatRepo(fakeModel({ findOne: jest.fn(() => ({ lean: () => ({ exec: async () => old }) })) }));
    const got = await repo.get("short-x");
    expect(got).toEqual({ ...defaultShortFormat("short-x", "X"), template: { ...defaultShortFormat().template, budgetMs: 60_000 } });
  });

  it("upsert keys on id and never $sets it", async () => {
    const model = fakeModel();
    await makeShortFormatRepo(model).upsert(full);
    const [filter, update] = (model.updateOne as jest.Mock).mock.calls[0];
    expect(filter).toEqual({ id: "short-uk" });
    expect(update.$set).not.toHaveProperty("id");
    expect(update.$setOnInsert).toEqual({ id: "short-uk" });
  });

  it("list sorts by name; get is null when missing; remove reports a miss", async () => {
    const sort = jest.fn(() => ({ lean: () => ({ exec: async () => [] }) }));
    const repo = makeShortFormatRepo(
      fakeModel({
        find: jest.fn(() => ({ sort })),
        findOne: jest.fn(() => ({ lean: () => ({ exec: async () => null }) })),
        deleteOne: jest.fn(() => ({ exec: async () => ({ deletedCount: 0 }) })),
      }),
    );
    expect(await repo.list()).toEqual([]);
    expect(sort).toHaveBeenCalledWith({ name: 1 });
    expect(await repo.get("nope")).toBeNull();
    expect(await repo.remove("nope")).toBe(false);
  });
});
