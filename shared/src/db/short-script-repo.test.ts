import mongoose, { type Model } from "mongoose";
import { makeShortScriptRepo } from "./short-script-repo";
import { getShortScriptModel, type iShortScriptModel } from "./short-script-model";
import type { ShortScript, ShortScriptPlay } from "../short-script";

const preview: ShortScriptPlay = {
  sceneId: "shorts-preview",
  startedAt: 1_700_000_000_000,
  playNonce: 7,
  stopped: true,
  endedAt: 1_700_000_075_000,
  runId: "run-1",
  clips: [
    { id: "c1", startMs: 0, durationMs: 30_000 },
    { id: "c2", startMs: 30_000, durationMs: 15_000 },
  ],
  skipped: [{ id: "c3", reason: "alert expired" }],
};

const render: ShortScriptPlay = {
  sceneId: "shorts",
  startedAt: 1_700_000_100_000,
  playNonce: 8,
  clips: [{ id: "c1", startMs: 0, durationMs: 30_000 }],
  skipped: [],
};

/** Every field, optional ones included, so the round-trip proves none is dropped. */
const full: ShortScript = {
  id: "s1",
  formatId: "short-uk",
  template: "lineup",
  scope: { type: "country", id: "japan" },
  include: { alerts: true, quakes: false, volcanoes: true },
  title: "Japan tonight",
  status: "ready",
  clips: [
    {
      id: "c1",
      target: "country:japan",
      durationMs: 30_000,
      maxStops: 3,
      tourDwellMs: 12_000,
      leadSlide: "roundup",
      roundupDepth: "summary",
      look: {
        basemap: "satellite",
        wind: { numParticles: 9000, speedFactor: 16, maxAge: 16, width: 2.5, opacity: 1, color: "#cfe8ff" },
        showSatImg: true,
        satImgLook: "geocolor",
        activeVariable: "temp",
        satImgFeeds: { himawari: { on: true, opacity: 0.6, look: "geocolor" } },
        auroraOpacity: 0.4,
        magneticFieldOpacity: null,
      },
      label: { title: "Japan", subtitle: "Country round-up", icon: "🇯🇵" },
    },
    { id: "c2", target: "quake:us7000abcd", durationMs: 15_000, label: { title: "M6.1 Earthquake" } },
  ],
  plays: [preview, render],
};

/**
 * What Mongo would store for `$set` on insert: cast through the REAL strict
 * schema (an unopened connection — no server needed), so any field the schema
 * doesn't declare is dropped exactly as it would be on a real write.
 */
function throughSchema(set: Record<string, unknown>, id: string) {
  const Real = getShortScriptModel(mongoose.createConnection());
  return new Real({ ...set, id }).toObject({ versionKey: false });
}

function fakeModel(
  overrides: Partial<Record<"updateOne" | "findOne" | "find" | "deleteOne", jest.Mock>> = {},
  seedPlays: ShortScriptPlay[] | null = full.plays!,
) {
  let stored: unknown = null;
  const updateOne =
    overrides.updateOne ??
    jest.fn((filter: { id: string }, update: { $set: Record<string, unknown> }) => {
      // Upsert never writes `plays` (the runner owns them): seed them here as
      // if stamped earlier, through the same strict schema.
      stored = throughSchema({ ...update.$set, ...(seedPlays ? { plays: seedPlays } : {}) }, filter.id);
      return { exec: async () => ({ matchedCount: 1 }) };
    });
  const findOne = overrides.findOne ?? jest.fn(() => ({ lean: () => ({ exec: async () => stored }) }));
  const find =
    overrides.find ?? jest.fn(() => ({ sort: () => ({ lean: () => ({ exec: async () => (stored ? [stored] : []) }) }) }));
  const deleteOne = overrides.deleteOne ?? jest.fn(() => ({ exec: async () => ({ deletedCount: 1 }) }));
  return { updateOne, findOne, find, deleteOne } as unknown as Model<iShortScriptModel>;
}

describe("makeShortScriptRepo", () => {
  it("round-trips a fully populated script through the strict schema with no field dropped", async () => {
    const repo = makeShortScriptRepo(fakeModel());
    const saved = await repo.upsert(full);
    expect(saved).toEqual(full);
    expect(await repo.get("s1")).toEqual(full);
  });

  it("round-trips a globe scope without inventing an id", async () => {
    const repo = makeShortScriptRepo(fakeModel({}, null));
    const globe: ShortScript = { ...full, id: "g1", scope: { type: "globe" } };
    delete globe.plays;
    expect(await repo.upsert(globe)).toEqual(globe);
  });

  it("reads a script saved before formats as the default format's", async () => {
    const { formatId: _f, plays: _p, ...legacy } = full;
    const repo = makeShortScriptRepo(fakeModel({}, null));
    const saved = await repo.upsert(legacy as ShortScript);
    expect(saved.formatId).toBe("shorts");
  });

  it("countByFormat counts a format's scripts, and format-less ones for the default", async () => {
    const countDocuments = jest.fn(() => ({ exec: async () => 4 }));
    const repo = makeShortScriptRepo({ countDocuments } as unknown as Model<iShortScriptModel>);
    expect(await repo.countByFormat("short-uk")).toBe(4);
    expect(countDocuments).toHaveBeenLastCalledWith({ formatId: "short-uk" });
    await repo.countByFormat("shorts");
    expect(countDocuments).toHaveBeenLastCalledWith({ $or: [{ formatId: "shorts" }, { formatId: null }, { formatId: "" }] });
  });

  it("upsert keys on id and never writes plays, even when the script carries some", async () => {
    const model = fakeModel();
    const repo = makeShortScriptRepo(model);
    await repo.upsert(full);
    const [filter, update] = (model.updateOne as jest.Mock).mock.calls[0];
    expect(filter).toEqual({ id: "s1" });
    expect(update.$set).not.toHaveProperty("plays");
    expect(update.$setOnInsert).toEqual({ id: "s1" });
  });

  it("list sorts newest first", async () => {
    const sort = jest.fn(() => ({ lean: () => ({ exec: async () => [] }) }));
    const repo = makeShortScriptRepo(fakeModel({ find: jest.fn(() => ({ sort })) }));
    expect(await repo.list()).toEqual([]);
    expect(sort).toHaveBeenCalledWith({ created: -1 });
  });

  it("get returns null when not found", async () => {
    const repo = makeShortScriptRepo(fakeModel({ findOne: jest.fn(() => ({ lean: () => ({ exec: async () => null }) })) }));
    expect(await repo.get("nope")).toBeNull();
  });

  it("remove reports whether a document was actually deleted", async () => {
    const repo = makeShortScriptRepo(fakeModel({ deleteOne: jest.fn(() => ({ exec: async () => ({ deletedCount: 0 }) })) }));
    expect(await repo.remove("nope")).toBe(false);
  });

  it("stampPlay reports an unknown id", async () => {
    const updateOne = jest.fn(() => ({ exec: async () => ({ matchedCount: 0 }) }));
    const repo = makeShortScriptRepo(fakeModel({ updateOne }));
    expect(await repo.stampPlay("nope", preview)).toBe(false);
  });
});

/**
 * An in-memory stand-in for the two single-document ops stampPlay issues —
 * positional `$set` on `plays.$` and a guarded `$push` — with Mongo's matching
 * rules, so the per-scene semantics can be checked without a server.
 */
function playsModel(initial: ShortScriptPlay[] | undefined) {
  const doc: { id: string; plays?: ShortScriptPlay[] } = { id: "s1", plays: initial && [...initial] };
  const updateOne = jest.fn((filter: Record<string, any>, update: Record<string, any>) => {
    let matched = 0;
    if (filter.id === doc.id) {
      const want = filter["plays.sceneId"];
      const has = (sceneId: string) => (doc.plays ?? []).some((p) => p.sceneId === sceneId);
      if (typeof want === "string" && has(want)) {
        matched = 1;
        const i = doc.plays!.findIndex((p) => p.sceneId === want);
        doc.plays![i] = update.$set["plays.$"];
      } else if (want && typeof want === "object" && !has(want.$ne)) {
        matched = 1;
        doc.plays = [...(doc.plays ?? []), update.$push.plays];
      }
    }
    return { exec: async () => ({ matchedCount: matched }) };
  });
  return { doc, model: { updateOne } as unknown as Model<iShortScriptModel>, updateOne };
}

describe("stampPlay — one entry per scene", () => {
  it("appends a scene's first play, guarded on the scene having none", async () => {
    const { doc, model, updateOne } = playsModel(undefined);
    expect(await makeShortScriptRepo(model).stampPlay("s1", preview)).toBe(true);
    expect(doc.plays).toEqual([preview]);
    expect(updateOne).toHaveBeenLastCalledWith({ id: "s1", "plays.sceneId": { $ne: "shorts-preview" } }, { $push: { plays: preview } });
  });

  it("replaces only that scene's entry in place, leaving the other scene's alone", async () => {
    const { doc, model, updateOne } = playsModel([preview, render]);
    const next: ShortScriptPlay = { ...preview, playNonce: 9, endedAt: undefined, stopped: undefined };
    expect(await makeShortScriptRepo(model).stampPlay("s1", next)).toBe(true);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith(
      { id: "s1", "plays.sceneId": "shorts-preview" },
      { $set: { "plays.$": { sceneId: "shorts-preview", playNonce: 9, startedAt: preview.startedAt, runId: "run-1", clips: preview.clips, skipped: preview.skipped } } },
    );
    expect(doc.plays!.map((p) => [p.sceneId, p.playNonce])).toEqual([["shorts-preview", 9], ["shorts", 8]]);
  });

  it("falls back to an in-place replace when a racing append from the same scene won", async () => {
    const { doc, model, updateOne } = playsModel(undefined);
    // The first replace misses (nothing there yet); before the append lands,
    // another write appends this scene's entry, so the guarded append misses too.
    updateOne.mockImplementationOnce(() => {
      doc.plays = [{ ...preview, playNonce: 1 }];
      return { exec: async () => ({ matchedCount: 0 }) };
    });
    expect(await makeShortScriptRepo(model).stampPlay("s1", preview)).toBe(true);
    expect(updateOne).toHaveBeenCalledTimes(3);
    expect(doc.plays).toEqual([preview]);
  });
});

describe("values (title codes, §6.8)", () => {
  it("round-trips string values through the strict schema and drops anything else", async () => {
    const stored = throughSchema({ ...full, plays: undefined, values: { place: "Japan", places: "1", bad: 3 } }, "s1");
    const findOne = jest.fn(() => ({ lean: () => ({ exec: async () => stored }) }));
    const got = await makeShortScriptRepo(fakeModel({ findOne }, null)).get("s1");
    expect(got?.values).toEqual({ place: "Japan", places: "1" });
  });

  it("stampValues sets only values, and upsert never writes them", async () => {
    const updateOne = jest.fn((..._a: unknown[]) => ({ exec: async () => ({ matchedCount: 1 }) }));
    const repo = makeShortScriptRepo(fakeModel({ updateOne }));
    expect(await repo.stampValues("s1", { place: "Japan" })).toBe(true);
    expect(updateOne).toHaveBeenCalledWith({ id: "s1" }, { $set: { values: { place: "Japan" } } });
    await repo.upsert({ ...full, values: { place: "x" } });
    expect((updateOne.mock.calls[1] as any[])[1].$set).not.toHaveProperty("values");
  });
});
