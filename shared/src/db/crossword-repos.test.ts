import mongoose from "mongoose";
import { getCrosswordPuzzleModel } from "./crossword-puzzle-model";
import { getCrosswordConfigModel } from "./crossword-config-model";
import { getCrosswordGameModel } from "./crossword-game-model";
import { getCrosswordSolveModel } from "./crossword-solve-model";
import { getCrosswordPlayerModel } from "./crossword-player-model";
import { makeCrosswordGameRepo } from "./crossword-game-repo";
import { makeCrosswordPuzzleRepo } from "./crossword-puzzle-repo";
import { makeCrosswordBankRepo } from "./crossword-bank-repo";
import { DEFAULT_CROSSWORD_CONFIG, emptyGame, numberEntries, type CrosswordPuzzle } from "../crossword";

/**
 * Cast through the REAL strict schemas (an unopened connection — no server
 * needed), so a field a schema doesn't declare is dropped exactly as it would
 * be on a real write.
 */
const conn = mongoose.createConnection();
afterAll(async () => {
  await conn.destroy().catch(() => undefined);
});
const strip = (o: Record<string, unknown>) => {
  const { _id, __v, created, updated, ...rest } = o;
  return rest;
};

const puzzle: CrosswordPuzzle = {
  id: "p1",
  title: "Space",
  width: 6,
  height: 5,
  entries: numberEntries([
    { answer: "CRATER", clue: "Bowl left by an impact", row: 0, col: 0, dir: "across", wordId: "w1", clueId: "c1" },
    { answer: "COMET", clue: "Icy visitor with a glowing tail", row: 0, col: 0, dir: "down", wordId: "w2", clueId: "c2" },
  ]),
  status: "ready",
  familyFriendly: true,
  source: "seed",
  createdAt: 123,
  plays: [{ sceneId: "xw", startedAt: 5, endedAt: 9 }, { sceneId: "xw2", startedAt: 7 }],
};

describe("crossword schemas keep every field", () => {
  it("puzzle", () => {
    const M = getCrosswordPuzzleModel(conn);
    expect(strip(new M(puzzle).toObject({ versionKey: false }))).toEqual(puzzle);
  });

  it("config", () => {
    const M = getCrosswordConfigModel(conn);
    const cfg = {
      ...DEFAULT_CROSSWORD_CONFIG,
      enabled: true,
      familyFriendlyOnly: false,
      blocklist: ["foo"],
      theme: { ...DEFAULT_CROSSWORD_CONFIG.theme, brand: { title: "Words", logoUrl: "/l.png" } },
    };
    expect(strip(new M({ ...cfg, id: "xw" }).toObject({ versionKey: false }))).toEqual({ ...cfg, id: "xw" });
    // Defaults come through on an empty doc.
    expect(strip(new M({ id: "xw" }).toObject({ versionKey: false }))).toEqual({ ...DEFAULT_CROSSWORD_CONFIG, id: "xw" });
  });

  it("game, including empty records", () => {
    const M = getCrosswordGameModel(conn);
    const { sceneId, ...g } = {
      ...emptyGame("xw", 1),
      solved: { "1A": { by: "host", name: "Host", at: 3, points: 0 } },
      spotlight: { entryId: "1D", startedAt: 1, endsAt: 2 },
    };
    expect(strip(new M({ ...g, id: sceneId }).toObject({ versionKey: false, minimize: false }))).toEqual({ ...g, id: sceneId });
  });

  it("solve and player", () => {
    const S = getCrosswordSolveModel(conn);
    const solve = { id: "s1", sceneId: "xw", puzzleId: "p1", entryId: "1A", playerId: "youtube:a", name: "Ann", points: 4, at: 9, late: true, sim: true };
    expect(strip(new S(solve).toObject({ versionKey: false }))).toEqual(solve);
    const P = getCrosswordPlayerModel(conn);
    const player = { id: "youtube:a", name: "Ann", hidden: true, firstSeen: 1, lastSeen: 2 };
    expect(strip(new P(player).toObject({ versionKey: false }))).toEqual(player);
  });
});

describe("repos", () => {
  it("game repo saves the whole game keyed by scene and reads it back", async () => {
    const stored: Record<string, any> = {};
    const model: any = {
      updateOne: jest.fn((f: any, u: any) => ({ exec: async () => { stored[f.id] = { ...u.$setOnInsert, ...u.$set }; return {}; } })),
      findOne: jest.fn((f: any, proj?: any) => ({
        lean: () => ({ exec: async () => (proj ? { pub: stored[f.id]?.pub } : stored[f.id] ?? null) }),
      })),
    };
    const repo = makeCrosswordGameRepo(model);
    const g = emptyGame("xw", 1);
    await repo.save(g);
    expect(await repo.get("xw")).toEqual(g);
    expect(await repo.getPublic("xw")).toEqual(g.pub);
    expect(await repo.get("nope")).toBeNull();
  });

  it("puzzle upsert never writes plays", async () => {
    const updateOne = jest.fn(() => ({ exec: async () => ({}) }));
    const model: any = { updateOne, findOne: () => ({ lean: () => ({ exec: async () => null }) }) };
    await makeCrosswordPuzzleRepo(model).upsert(puzzle);
    const calls = updateOne.mock.calls as unknown as [unknown, { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> }][];
    const [, update] = calls[0];
    expect(update.$set.plays).toBeUndefined();
    expect(update.$setOnInsert).toEqual({ id: "p1", plays: [] });
  });
});

describe("bank repo writes and pick (fake collections)", () => {
  const oid = (n: number) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, "0"));
  const fake = () => {
    const updates: { coll: string; filter: any; update: any }[] = [];
    const cluesFind = jest.fn((_f: any, _o?: any) => ({ toArray: async () => clueDocs }));
    let clueDocs: any[] = [];
    let wordDocs: any[] = [];
    let clueOne: any = null;
    const coll = (name: string) => ({
      updateOne: jest.fn(async (filter: any, update: any) => {
        updates.push({ coll: name, filter, update });
        return { matchedCount: 1 };
      }),
      findOne: jest.fn(async () => clueOne),
      find: name === "crosswordbankclues" ? cluesFind : jest.fn(() => ({ toArray: async () => wordDocs })),
    });
    const colls: Record<string, any> = { crosswordbankwords: coll("crosswordbankwords"), crosswordbankclues: coll("crosswordbankclues") };
    const conn: any = { db: { collection: (n: string) => colls[n] } };
    const repo = makeCrosswordBankRepo(conn, { now: () => 1000 });
    return {
      repo,
      updates,
      cluesFind,
      setClues: (d: any[]) => (clueDocs = d),
      setWords: (d: any[]) => (wordDocs = d),
      setClueOne: (d: any) => (clueOne = d),
    };
  };

  it("records who and when on approval and tag writes", async () => {
    const f = fake();
    expect(await f.repo.setWordApproval(String(oid(1)), "approved", "rich")).toBe(true);
    expect(await f.repo.setClueFamilyFriendly(String(oid(2)), null, "")).toBe(true);
    expect(await f.repo.setWordApproval("not-an-id", "approved", "rich")).toBe(false);
    expect(await f.repo.setWordApproval(String(oid(1)), "maybe" as never, "rich")).toBe(false);
    expect(f.updates[0].update.$set.approval).toEqual({ status: "approved", by: "rich", at: 1000 });
    expect(f.updates[1].update.$set).toMatchObject({ familyFriendly: null, familyFriendlyBy: "operator", familyFriendlyAt: 1000 });
  });

  it("an edit returns an approved clue to pending and keeps the first original", async () => {
    const f = fake();
    f.setClueOne({ _id: oid(3), clue: "Old text", approval: { status: "approved", by: "a", at: 1 } });
    expect(await f.repo.editClue(String(oid(3)), "  New   text ", "rich")).toBe(true);
    expect(f.updates[0].update.$set).toMatchObject({
      clue: "New text",
      original: "Old text",
      editedBy: "rich",
      editedAt: 1000,
      approval: { status: "pending", by: "rich", at: 1000 },
    });
    f.setClueOne({ _id: oid(3), clue: "New text", original: "Old text", approval: { status: "rejected" } });
    await f.repo.editClue(String(oid(3)), "Third", "rich");
    expect(f.updates[1].update.$set.original).toBeUndefined();
    expect(f.updates[1].update.$set.approval).toBeUndefined();
    expect(await f.repo.editClue(String(oid(3)), "   ", "rich")).toBe(false);
  });

  it("an approval stores the cleaned text the queue showed, keeping the original", async () => {
    const f = fake();
    f.setClueOne({ _id: oid(4), clue: "Path round a star (5)" });
    expect(await f.repo.setClueApproval(String(oid(4)), "approved", "rich")).toBe(true);
    expect(f.updates[0].update.$set).toMatchObject({
      clue: "Path round a star",
      original: "Path round a star (5)",
      approval: { status: "approved", by: "rich", at: 1000 },
    });
    // Already clean: the text is left alone; a rejection never rewrites it.
    f.setClueOne({ _id: oid(4), clue: "Path round a star" });
    await f.repo.setClueApproval(String(oid(4)), "approved", "rich");
    expect(f.updates[1].update.$set.clue).toBeUndefined();
    expect(f.updates[1].update.$set.original).toBeUndefined();
    f.setClueOne({ _id: oid(4), clue: "Messy (5)" });
    await f.repo.setClueApproval(String(oid(4)), "rejected", "rich");
    expect(f.updates[2].update.$set.clue).toBeUndefined();
    // A first original is kept.
    f.setClueOne({ _id: oid(4), clue: "Path round a star (5)", original: "First" });
    await f.repo.setClueApproval(String(oid(4)), "approved", "rich");
    expect(f.updates[3].update.$set.original).toBeUndefined();
  });

  it("an edit clears the clue's family-friendly tag, with who and when", async () => {
    const f = fake();
    f.setClueOne({ _id: oid(5), clue: "Old", familyFriendly: true, approval: { status: "pending" } });
    await f.repo.editClue(String(oid(5)), "New clue text", "rich");
    expect(f.updates[0].update.$set).toMatchObject({ familyFriendly: null, familyFriendlyBy: "rich", familyFriendlyAt: 1000 });
  });

  it("the pick cleans approved clues too", async () => {
    const f = fake();
    f.setWords([{ _id: oid(1), norm: "ORBIT", length: 5, approval: { status: "approved" } }]);
    f.setClues([{ _id: oid(9), answerId: oid(1), clue: "  Path round a star (5) " }]);
    const [w] = await f.repo.playable({ minZipf: 0 });
    expect(w.clues[0].text).toBe("Path round a star");
  });

  it("the playable pick returns each word with its clues and drops a word with none", async () => {
    const f = fake();
    f.setWords([
      { _id: oid(1), norm: "ORBIT", length: 5, validation: { sources: { wordfreq: { zipf: 4.2 } } }, familyFriendly: true },
      { _id: oid(2), norm: "COMET", length: 5 },
    ]);
    f.setClues([{ _id: oid(9), answerId: oid(1), clue: "Path round a star", familyFriendly: true }]);
    const out = await f.repo.playable({ minZipf: 3, familyFriendlyOnly: true });
    expect(out).toEqual([
      {
        id: String(oid(1)),
        norm: "ORBIT",
        length: 5,
        zipf: 4.2,
        familyFriendly: true,
        clues: [{ id: String(oid(9)), text: "Path round a star", familyFriendly: true }],
      },
    ]);
    expect(f.cluesFind.mock.calls[0][0]).toMatchObject({ "approval.status": "approved", familyFriendly: true });
  });
});
