import mongoose from "mongoose";
import { getCrosswordPuzzleModel } from "./crossword-puzzle-model";
import { getCrosswordConfigModel } from "./crossword-config-model";
import { getCrosswordGameModel } from "./crossword-game-model";
import { getCrosswordSolveModel } from "./crossword-solve-model";
import { getCrosswordPlayerModel } from "./crossword-player-model";
import { makeCrosswordGameRepo } from "./crossword-game-repo";
import { makeCrosswordPuzzleRepo } from "./crossword-puzzle-repo";
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
  theme: "space",
  width: 6,
  height: 5,
  entries: numberEntries([
    { answer: "CRATER", clue: "Bowl left by an impact", row: 0, col: 0, dir: "across" },
    { answer: "COMET", clue: "Icy visitor with a glowing tail", row: 0, col: 0, dir: "down" },
  ]),
  status: "ready",
  source: "seed",
  model: "some/model",
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
    const cfg = { ...DEFAULT_CROSSWORD_CONFIG, enabled: true, themes: ["weather"], blocklist: ["foo"] };
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
