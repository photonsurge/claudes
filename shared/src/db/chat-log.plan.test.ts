/**
 * WP8's storage side, from docs/crossword-mode-plan.md §6.4 and §4.6:
 *  - the chat-log model gains `authorChannelId` (a stored message keeps it);
 *  - the today board counts only solves since the start of the UTC day and
 *    leaves hidden players out.
 * No Mongo: the model is built on an unopened connection, and the board's
 * aggregate is captured from a fake model.
 */
import mongoose, { type Model } from "mongoose";
import { getChatLogMessageModel } from "./chat-log-model";
import { makeCrosswordSolveRepo } from "./crossword-solve-repo";
import type { iCrosswordSolveModel } from "./crossword-solve-model";
import { startOfUtcDay } from "../crossword-records";

describe("chat log: authorChannelId", () => {
  const conn = mongoose.createConnection();
  afterAll(() => conn.close());

  test("a stored message keeps the author's channel id", () => {
    const M = getChatLogMessageModel(conn);
    const doc = new M({ id: "m1", runId: "r1", sceneId: "xw", platform: "youtube", author: "Ann", authorChannelId: "UC_ann", text: "cat", ts: 1 });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.toObject().authorChannelId).toBe("UC_ann");
  });

  test("it stays optional", () => {
    const M = getChatLogMessageModel(conn);
    const doc = new M({ id: "m2", runId: "r1", sceneId: "xw", platform: "youtube", author: "Ann", text: "cat", ts: 1 });
    expect(doc.validateSync()).toBeUndefined();
  });
});

describe("today board", () => {
  test("since the start of the UTC day, hidden players excluded", async () => {
    const aggregate = jest.fn(() => ({ exec: async () => [{ _id: "youtube:a", name: "Ann", points: 3, words: 1 }] }));
    const repo = makeCrosswordSolveRepo({ aggregate } as unknown as Model<iCrosswordSolveModel>);
    const now = Date.UTC(2026, 9, 5, 0, 30);
    const since = startOfUtcDay(now);
    expect(since).toBe(Date.UTC(2026, 9, 5));
    const rows = await repo.board({ sceneId: "xw", since, hiddenIds: ["youtube:hid"] });
    expect(rows).toEqual([{ playerId: "youtube:a", name: "Ann", points: 3, words: 1 }]);
    const pipeline = (aggregate.mock.calls[0] as unknown as [any[]])[0];
    const match = pipeline.find((s) => s.$match).$match;
    expect(match).toMatchObject({ sceneId: "xw", at: { $gte: since }, playerId: { $nin: ["youtube:hid"] } });
  });

  test("startOfUtcDay is UTC, not local", () => {
    expect(startOfUtcDay(Date.UTC(2026, 9, 5, 23, 59, 59, 999))).toBe(Date.UTC(2026, 9, 5));
    expect(startOfUtcDay(Date.UTC(2026, 9, 6))).toBe(Date.UTC(2026, 9, 6));
  });
});
