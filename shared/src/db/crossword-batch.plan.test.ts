/**
 * The cross-package batch on the db side, against docs/crossword-mode-plan.md
 * §4.4, §7.4, §8.3 and §10, written from the plan and the batch's intent:
 *
 *  - nothing airs unapproved: a bank decision (reject, back to pending, an
 *    edit to an approved clue) takes every ready puzzle using that word or
 *    clue out of play; a family-friendly tag taken off clears it on them;
 *  - two workers never host one game: a save lands only over an older game;
 *  - the unapproved marker survives the store;
 *  - the Words list caps a filtered count at 10,000;
 *  - listScenes carries the YouTube account a channel goes out on.
 *
 * The puzzle and game repos run over a small in-memory fake that honours
 * Mongo's filter semantics for the operators these repos use, so the tests
 * check what is stored, not which calls were made.
 */
import mongoose from "mongoose";
import { createDb } from "./index";
import { makeCrosswordPuzzleRepo } from "./crossword-puzzle-repo";
import { makeCrosswordGameRepo } from "./crossword-game-repo";
import { makeCrosswordBankRepo } from "./crossword-bank-repo";
import { MAIN_SCENE_ID } from "../control";
import { emptyGame, numberEntries, type CrosswordGame, type CrosswordPuzzle } from "../crossword";

// ---------------------------------------------------------------------------
// A tiny Mongo-ish matcher and model
// ---------------------------------------------------------------------------

const getPath = (doc: any, path: string): unknown[] => {
  // Returns every value at `path`, descending into arrays (Mongo's dotted-path semantics).
  let cur: unknown[] = [doc];
  for (const part of path.split(".")) {
    const next: unknown[] = [];
    for (const v of cur) {
      if (Array.isArray(v)) for (const x of v) next.push((x as any)?.[part]);
      else if (v && typeof v === "object") next.push((v as any)[part]);
      else next.push(undefined);
    }
    cur = next.flatMap((v) => (Array.isArray(v) && path.split(".").length > 1 ? [v, ...v] : [v]));
  }
  return cur;
};

function matchCond(values: unknown[], cond: unknown): boolean {
  if (cond && typeof cond === "object" && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith("$"))) {
    return Object.entries(cond as Record<string, unknown>).every(([op, arg]) => {
      switch (op) {
        case "$lt":
          return values.some((v) => typeof v === "number" && v < (arg as number));
        case "$lte":
          return values.some((v) => typeof v === "number" && v <= (arg as number));
        case "$gt":
          return values.some((v) => typeof v === "number" && v > (arg as number));
        case "$in":
          return values.some((v) => (arg as unknown[]).includes(v));
        case "$exists":
          return values.some((v) => v !== undefined) === arg;
        case "$ne":
          return !values.some((v) => v === arg);
        default:
          throw new Error(`fake: unsupported ${op}`);
      }
    });
  }
  return values.some((v) => v === cond || (Array.isArray(v) && v.includes(cond)));
}

function matches(doc: any, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === "$or") return (cond as Record<string, unknown>[]).some((f) => matches(doc, f));
    if (k === "$and") return (cond as Record<string, unknown>[]).every((f) => matches(doc, f));
    return matchCond(getPath(doc, k), cond);
  });
}

const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

/** An in-memory collection behind the subset of the Mongoose model API the repos use, with a unique `id`. */
function fakeModel(initial: any[] = []) {
  const docs: any[] = clone(initial);
  const chain = (result: () => any) => {
    const c: any = { sort: () => c, limit: () => c, skip: () => c, lean: () => c, exec: async () => clone(result()) };
    return c;
  };
  const apply = (doc: any, update: any) => {
    for (const [k, v] of Object.entries(update.$set ?? {})) doc[k] = clone(v);
  };
  const model: any = {
    docs,
    find: (filter: any = {}) => chain(() => docs.filter((d) => matches(d, filter))),
    findOne: (filter: any = {}) => chain(() => docs.find((d) => matches(d, filter)) ?? null),
    updateOne: (filter: any, update: any, opts: any = {}) => ({
      exec: async () => {
        const doc = docs.find((d) => matches(d, filter));
        if (doc) {
          apply(doc, update);
          return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        }
        if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        const fresh: any = { ...clone(update.$setOnInsert ?? {}) };
        if (typeof filter.id === "string") fresh.id = filter.id;
        apply(fresh, update);
        if (docs.some((d) => d.id === fresh.id)) {
          throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
        }
        docs.push(fresh);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      },
    }),
    updateMany: (filter: any, update: any) => ({
      exec: async () => {
        const hit = docs.filter((d) => matches(d, filter));
        hit.forEach((d) => apply(d, update));
        return { matchedCount: hit.length, modifiedCount: hit.length };
      },
    }),
  };
  return model;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const conn = mongoose.createConnection();
afterAll(async () => {
  await conn.destroy().catch(() => undefined);
});

function puzzle(id: string, words: [string, string][], o: Partial<CrosswordPuzzle> = {}): CrosswordPuzzle {
  // words: [wordId, clueId] pairs, laid out as a column of across entries.
  const answers = ["CAT", "DOG", "EEL", "OWL", "APE"];
  return {
    id,
    title: id,
    width: 3,
    height: words.length,
    entries: numberEntries(
      words.map(([wordId, clueId], i) => ({ answer: answers[i], clue: `Clue for ${answers[i]}`, row: i, col: 0, dir: "across" as const, wordId, clueId })),
    ),
    status: "ready",
    familyFriendly: true,
    source: "bank",
    createdAt: 1,
    plays: [],
    ...o,
  };
}

/** A db facade whose puzzle repo is real over the fake, and whose bank decisions all succeed for known ids. */
function cascadeWorld() {
  const db = createDb(conn);
  const model = fakeModel([
    puzzle("p1", [["w1", "c1"], ["w2", "c2"]]),
    puzzle("p2", [["w1", "c3"], ["w4", "c4"]]),
    puzzle("p3", [["w5", "c5"], ["w6", "c6"]]),
    puzzle("old", [["w1", "c1"]], { status: "rejected" }),
  ]);
  (db as any).crosswordPuzzles = makeCrosswordPuzzleRepo(model);
  const known = new Set(["w1", "w2", "w4", "w5", "w6", "c1", "c2", "c3", "c4", "c5", "c6"]);
  const ok = jest.fn(async (id: string) => known.has(id));
  (db as any).crosswordBank = {
    setWordApproval: ok,
    setWordFamilyFriendly: ok,
    setClueApproval: ok,
    setClueFamilyFriendly: ok,
    editClue: ok,
  };
  const byId = (id: string) => model.docs.find((d: any) => d.id === id);
  const status = () => Object.fromEntries(model.docs.map((d: any) => [d.id, d.status]));
  const ff = () => Object.fromEntries(model.docs.map((d: any) => [d.id, d.familyFriendly]));
  return { db, model, byId, status, ff };
}

// ---------------------------------------------------------------------------
// Nothing airs unapproved (§7.4)
// ---------------------------------------------------------------------------

describe("bank decisions reach built puzzles (§7.4)", () => {
  it("rejecting a word takes every ready puzzle using it out of play, and only those", async () => {
    const w = cascadeWorld();
    const res = await w.db.setCrosswordWordApproval("w1", "rejected", "op");
    expect(res.ok).toBe(true);
    expect([...res.rejected].sort()).toEqual(["p1", "p2"]);
    expect(w.status()).toEqual({ p1: "rejected", p2: "rejected", p3: "ready", old: "rejected" });
  });

  it("returning a word to pending does the same", async () => {
    const w = cascadeWorld();
    await w.db.setCrosswordWordApproval("w2", "pending", "op");
    expect(w.status()).toMatchObject({ p1: "rejected", p2: "ready", p3: "ready" });
  });

  it("rejecting or un-approving a clue takes out the puzzles using that clue, not every puzzle using its word", async () => {
    const w = cascadeWorld();
    const res = await w.db.setCrosswordClueApproval("c3", "rejected", "op");
    expect(res.rejected).toEqual(["p2"]);
    expect(w.status()).toMatchObject({ p1: "ready", p2: "rejected", p3: "ready" });
    await w.db.setCrosswordClueApproval("c5", "pending", "op");
    expect(w.status()).toMatchObject({ p3: "rejected" });
  });

  it("editing a clue takes its ready puzzles out of play", async () => {
    const w = cascadeWorld();
    const res = await w.db.editCrosswordClue("c1", "A brand new clue", "op");
    expect(res.ok).toBe(true);
    expect(res.rejected).toEqual(["p1"]);
    expect(w.status()).toMatchObject({ p1: "rejected", p2: "ready" });
  });

  it("approving touches no puzzle", async () => {
    const w = cascadeWorld();
    const before = clone(w.model.docs);
    await w.db.setCrosswordWordApproval("w1", "approved", "op");
    await w.db.setCrosswordClueApproval("c1", "approved", "op");
    expect(w.model.docs).toEqual(before);
  });

  it("a rejected puzzle is never brought back by a later approval", async () => {
    const w = cascadeWorld();
    await w.db.setCrosswordWordApproval("w1", "rejected", "op");
    await w.db.setCrosswordWordApproval("w1", "approved", "op");
    expect(w.status()).toMatchObject({ p1: "rejected", p2: "rejected" });
  });

  it("taking a word's family-friendly tag off (false or untagged) clears familyFriendly on the puzzles using it", async () => {
    const w = cascadeWorld();
    const res = await w.db.setCrosswordWordFamilyFriendly("w2", false, "op");
    expect(res.untagged).toEqual(["p1"]);
    expect(w.ff()).toMatchObject({ p1: false, p2: true, p3: true });
    await w.db.setCrosswordWordFamilyFriendly("w4", null, "op");
    expect(w.ff()).toMatchObject({ p2: false, p3: true });
    // The tag alone does not take a puzzle out of play.
    expect(w.status()).toMatchObject({ p1: "ready", p2: "ready" });
  });

  it("taking a clue's tag off clears familyFriendly on the puzzles using that clue", async () => {
    const w = cascadeWorld();
    await w.db.setCrosswordClueFamilyFriendly("c6", false, "op");
    expect(w.ff()).toMatchObject({ p1: true, p2: true, p3: false });
  });

  it("tagging family friendly never sets the flag on a puzzle (other words may not carry it)", async () => {
    const w = cascadeWorld();
    w.byId("p1").familyFriendly = false;
    await w.db.setCrosswordWordFamilyFriendly("w1", true, "op");
    await w.db.setCrosswordClueFamilyFriendly("c1", true, "op");
    expect(w.byId("p1").familyFriendly).toBe(false);
  });

  it("an unknown word or clue reports not ok and changes no puzzle", async () => {
    const w = cascadeWorld();
    const before = clone(w.model.docs);
    expect((await w.db.setCrosswordWordApproval("nope", "rejected", "op")).ok).toBe(false);
    expect((await w.db.setCrosswordClueApproval("nope", "rejected", "op")).ok).toBe(false);
    expect((await w.db.editCrosswordClue("nope", "Some new text", "op")).ok).toBe(false);
    expect((await w.db.setCrosswordWordFamilyFriendly("nope", false, "op")).ok).toBe(false);
    expect(w.model.docs).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// The unapproved marker survives the store (§7.4 dev switch)
// ---------------------------------------------------------------------------

describe("puzzles built from unapproved words stay marked", () => {
  it("an unapproved puzzle reads back unapproved; an approved one reads back unmarked", async () => {
    const repo = makeCrosswordPuzzleRepo(fakeModel());
    await repo.upsert(puzzle("u", [["w1", "c1"]], { unapproved: true }));
    await repo.upsert(puzzle("a", [["w1", "c1"]]));
    expect((await repo.get("u"))?.unapproved).toBe(true);
    expect((await repo.get("a"))?.unapproved).not.toBe(true);
    const listed = await repo.list({ status: "ready" });
    expect(listed.find((p) => p.id === "u")?.unapproved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Two workers never host one game (§4.4)
// ---------------------------------------------------------------------------

describe("game saves are conditional on seq", () => {
  const game = (seq: number, mark = ""): CrosswordGame => ({ ...emptyGame("xw", 1), seq, puzzleId: mark });

  it("the first save lands", async () => {
    const repo = makeCrosswordGameRepo(fakeModel());
    expect(await repo.save(game(1, "a"))).toBe(true);
    expect((await repo.get("xw"))?.puzzleId).toBe("a");
  });

  it("a newer seq lands; an equal or older one is refused and leaves the stored game alone", async () => {
    const repo = makeCrosswordGameRepo(fakeModel());
    await repo.save(game(5, "five"));
    expect(await repo.save(game(5, "other-five"))).toBe(false);
    expect(await repo.save(game(3, "three"))).toBe(false);
    expect((await repo.get("xw"))?.puzzleId).toBe("five");
    expect(await repo.save(game(6, "six"))).toBe(true);
    expect((await repo.get("xw"))?.seq).toBe(6);
    expect((await repo.get("xw"))?.puzzleId).toBe("six");
  });

  it("two hosts racing from the same game: exactly one of them wins each seq", async () => {
    const repo = makeCrosswordGameRepo(fakeModel());
    await repo.save(game(10));
    const [a, b] = await Promise.all([repo.save(game(11, "A")), repo.save(game(11, "B"))]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await repo.get("xw"))?.puzzleId).toBe(a ? "A" : "B");
  });

  it("scenes are independent", async () => {
    const repo = makeCrosswordGameRepo(fakeModel());
    await repo.save(game(9));
    expect(await repo.save({ ...emptyGame("other", 1), seq: 1 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The Words list caps its count (§8.3)
// ---------------------------------------------------------------------------

describe("Words list count cap", () => {
  function bank(count: number) {
    const coll = (rows: any[]) => ({
      find: () => {
        const c: any = { sort: () => c, skip: () => c, limit: () => c, toArray: async () => rows };
        return c;
      },
      aggregate: () => ({ toArray: async () => [] }),
      // Honour a count limit as Mongo does.
      countDocuments: jest.fn(async (_f: unknown, o?: { limit?: number }) => Math.min(count, o?.limit ?? Infinity)),
      estimatedDocumentCount: jest.fn(async () => count),
    });
    const words = coll([]);
    const c: any = { db: { collection: (n: string) => (n === "crosswordbankwords" ? words : coll([])) } };
    return { repo: makeCrosswordBankRepo(c), words };
  }

  it("a filtered list over 10,000 matches says 10,000 and capped", async () => {
    const { repo } = bank(250_000);
    const res = await repo.listWords({ startsWith: "s" } as never);
    expect(res.total).toBe(10_000);
    expect(res.totalCapped).toBe(true);
  });

  it("at or under the cap the count is exact", async () => {
    for (const n of [0, 42, 10_000]) {
      const { repo } = bank(n);
      const res = await repo.listWords({ startsWith: "s" } as never);
      expect([n, res.total, res.totalCapped]).toEqual([n, n, false]);
    }
  });

  it("a filtered count never scans past the cap", async () => {
    const { repo, words } = bank(250_000);
    await repo.listWords({ startsWith: "s" } as never);
    for (const call of words.countDocuments.mock.calls) {
      expect((call as unknown[])[1]).toMatchObject({ limit: expect.any(Number) });
      expect(((call as unknown[])[1] as { limit: number }).limit).toBeLessThanOrEqual(10_001);
    }
  });
});

// ---------------------------------------------------------------------------
// listScenes carries youtubeAccountId (§8.1, §10)
// ---------------------------------------------------------------------------

describe("listScenes and the YouTube account", () => {
  it("each channel carries the account in its youtube.accountId; none stored means none listed", async () => {
    const db = createDb(conn);
    (db.broadcastState as any).getAll = jest.fn(async () => ({
      success: true,
      data: [
        { id: MAIN_SCENE_ID, name: "Main", youtube: { accountId: "UCweather" } },
        { id: "words", name: "Words", surface: "crossword", youtube: { accountId: "UCwords", title: "x" } },
        { id: "blank", name: "Blank", surface: "crossword", youtube: { accountId: "" } },
        { id: "bare", name: "Bare" },
      ],
    }));
    const scenes = await db.listScenes();
    const of = Object.fromEntries(scenes.map((s) => [s.id, s.youtubeAccountId]));
    expect(of).toEqual({ [MAIN_SCENE_ID]: "UCweather", words: "UCwords", blank: undefined, bare: undefined });
  });
});
