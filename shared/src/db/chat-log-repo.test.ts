/**
 * Chat-log repo contract: append is idempotent (duplicate-key bulk errors are
 * swallowed, real errors are not) and listForRun returns clean wire-shaped
 * messages in air order with no default cap.
 */
import type { Model } from "mongoose";
import { makeChatLogRepo } from "./chat-log-repo";
import type { iChatLogMessage } from "./chat-log-model";
import type { ChatMessage } from "../runs";

const msg = (id: string): ChatMessage => ({
  runId: "r1",
  sceneId: "main",
  platform: "youtube",
  id,
  author: "ann",
  text: `msg ${id}`,
  ts: 1_000,
});

const makeModel = () => {
  const exec = jest.fn();
  const lean = jest.fn(() => ({ exec }));
  const limit = jest.fn(() => ({ lean }));
  const sort = jest.fn(() => ({ limit, lean }));
  const find = jest.fn(() => ({ sort }));
  const insertMany = jest.fn();
  return { model: { insertMany, find } as unknown as Model<iChatLogMessage>, insertMany, find, sort, limit, exec };
};

describe("append", () => {
  it("no-ops on an empty batch", async () => {
    const { model, insertMany } = makeModel();
    expect(await makeChatLogRepo(model).append([])).toBe(0);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it("inserts unordered and returns the inserted count", async () => {
    const { model, insertMany } = makeModel();
    insertMany.mockResolvedValue([{}, {}]);
    expect(await makeChatLogRepo(model).append([msg("a"), msg("b")])).toBe(2);
    expect(insertMany).toHaveBeenCalledWith([msg("a"), msg("b")], { ordered: false });
  });

  it("swallows duplicate-key bulk errors, returning what did insert", async () => {
    const { model, insertMany } = makeModel();
    insertMany.mockRejectedValue({ writeErrors: [{ code: 11000 }], insertedDocs: [{}] });
    expect(await makeChatLogRepo(model).append([msg("a"), msg("b")])).toBe(1);
  });

  it("swallows a plain duplicate-key error with no writeErrors", async () => {
    const { model, insertMany } = makeModel();
    insertMany.mockRejectedValue({ code: 11000 });
    expect(await makeChatLogRepo(model).append([msg("a")])).toBe(0);
  });

  it("rethrows non-duplicate bulk errors", async () => {
    const { model, insertMany } = makeModel();
    insertMany.mockRejectedValue({ writeErrors: [{ code: 121 }], insertedDocs: [] });
    await expect(makeChatLogRepo(model).append([msg("a")])).rejects.toEqual(
      expect.objectContaining({ writeErrors: [{ code: 121 }] }),
    );
  });
});

describe("listForRun", () => {
  it("returns wire-shaped messages in ts order, stripping Mongo internals, with no default cap", async () => {
    const { model, find, sort, limit, exec } = makeModel();
    exec.mockResolvedValue([{ ...msg("a"), _id: "x", __v: 0, created: new Date(), updated: new Date() }]);
    const out = await makeChatLogRepo(model).listForRun("r1");
    expect(find).toHaveBeenCalledWith({ runId: "r1" });
    expect(sort).toHaveBeenCalledWith({ ts: 1, id: 1 });
    expect(limit).not.toHaveBeenCalled();
    expect(out).toEqual([msg("a")]);
  });

  it("applies since and limit when given", async () => {
    const { model, find, limit, exec } = makeModel();
    exec.mockResolvedValue([]);
    await makeChatLogRepo(model).listForRun("r1", { since: 123, limit: 5 });
    expect(find).toHaveBeenCalledWith({ runId: "r1", ts: { $gt: 123 } });
    expect(limit).toHaveBeenCalledWith(5);
  });
});
