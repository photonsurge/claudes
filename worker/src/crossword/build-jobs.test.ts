jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogWarn: jest.fn(), blogErr: jest.fn() }));
import { UnrecoverableError } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_CROSSWORD_CONFIG } from "@photonsurge/shared/crossword";
import { bankIndex, generate, topUp } from "./build-jobs";

const job = (event: string, data: unknown = {}) => ({ id: "1", data: { domain: "crossword", type: "crossword", event, data } }) as any;

/** No bank imported (the build falls back to the seed set) with one crossword scene. */
function fakeDb(cfg: Partial<typeof DEFAULT_CROSSWORD_CONFIG> = {}) {
  const made = new Set<string>(["xwbank_pick_ix"]);
  const ensureIndexes = jest.fn(async () => {
    // createIndex returns the name whether it made the index or found it there.
    for (const n of ["xwbank_norm_ix", "xwbank_approved_pick_ix"]) made.add(n);
    return ["xwbank_norm_ix", "xwbank_approved_pick_ix"];
  });
  const words = {
    estimatedDocumentCount: jest.fn(async () => 0),
    indexExists: jest.fn(async (n: string) => made.has(n)),
    dropIndex: jest.fn(async (n: string) => void made.delete(n)),
  };
  const upsert = jest.fn(async (p: any) => p);
  const db = {
    getOrInitCrosswordConfig: jest.fn(async () => ({ ...DEFAULT_CROSSWORD_CONFIG, ...cfg })),
    crosswordScenes: jest.fn(async () => ["xw"]),
    crosswordBank: { playable: jest.fn(async () => []), words: () => words, ensureIndexes, poolCounts: jest.fn() },
    crosswordPuzzles: {
      recentForScene: jest.fn(async () => []),
      upsert,
      list: jest.fn(async () => []),
      model: { countDocuments: () => ({ exec: async () => 6 }) },
    },
  };
  (getAppDb as jest.Mock).mockResolvedValue(db);
  return { db, ensureIndexes, upsert, made };
}

describe("crossword.bankIndex", () => {
  it("builds the indexes, drops the legacy pick index, and is idempotent", async () => {
    const f = fakeDb();
    const a = await bankIndex(job("bankIndex"));
    const b = await bankIndex(job("bankIndex"));
    expect(a).toEqual({ indexes: ["xwbank_norm_ix", "xwbank_approved_pick_ix"], dropped: ["xwbank_pick_ix"] });
    expect(b).toEqual({ indexes: a.indexes, dropped: [] });
    expect([...f.made].sort()).toEqual(["xwbank_approved_pick_ix", "xwbank_norm_ix"]);
  });

  it("rethrows a failure so the job retries", async () => {
    const f = fakeDb();
    f.ensureIndexes.mockRejectedValueOnce(new Error("mongo down"));
    await expect(bankIndex(job("bankIndex"))).rejects.toThrow("mongo down");
  });
});

describe("crossword.generate", () => {
  it("builds and stores a puzzle for the scene", async () => {
    const f = fakeDb();
    const result = await generate(job("generate", { sceneId: "xw", seed: 4 }));
    expect(f.upsert).toHaveBeenCalledTimes(1);
    const saved = f.upsert.mock.calls[0][0];
    expect(result).toMatchObject({
      id: saved.id,
      title: "Puzzle 7",
      status: "ready",
      familyFriendly: true,
      source: "seed",
      seed: 4,
      words: saved.entries.length,
    });
  });

  it("fails terminally: no scene, or too few words", async () => {
    fakeDb();
    await expect(generate(job("generate", {}))).rejects.toBeInstanceOf(UnrecoverableError);
    fakeDb({ minWords: 30 });
    await expect(generate(job("generate", { sceneId: "xw", seed: 1 }))).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe("crossword.topUp", () => {
  it("builds for an enabled scene short of stock", async () => {
    const f = fakeDb({ enabled: true });
    const result = await topUp(job("topUp"));
    expect(result.scenes).toEqual([expect.objectContaining({ sceneId: "xw", outcome: "built", familyFriendly: true })]);
    expect(f.upsert).toHaveBeenCalledTimes(1);
  });

  it("skips a scene the pool cannot supply, without failing the job", async () => {
    const f = fakeDb({ enabled: true, minWords: 60 });
    const result = await topUp(job("topUp"));
    expect(result.scenes).toEqual([{ sceneId: "xw", outcome: "skipped", reason: expect.stringMatching(/seed words/) }]);
    expect(f.upsert).not.toHaveBeenCalled();
  });
});
