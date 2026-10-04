import type { Model } from "mongoose";
import { makeDirectorCommandRepo } from "./director-command-repo";
import { COMMAND_RETENTION_MS, DirectorCommandSchema, type iDirectorCommand } from "./director-command-model";

const makeModel = () => {
  const exec = jest.fn();
  const lean = jest.fn(() => ({ exec }));
  const limit = jest.fn(() => ({ lean }));
  const sort = jest.fn(() => ({ lean, limit }));
  const find = jest.fn(() => ({ sort }));
  const findOne = jest.fn(() => ({ lean }));
  const create = jest.fn(async () => undefined);
  const updateOne = jest.fn(() => ({ exec }));
  const updateMany = jest.fn(() => ({ exec }));
  const model = { find, findOne, create, updateOne, updateMany } as unknown as Model<iDirectorCommand>;
  return { model, exec, find, sort, limit, create, updateOne, updateMany };
};

const NOW = 5_000_000;

describe("director command repo", () => {
  it("enqueues a queued row with its expiry", async () => {
    const m = makeModel();
    const out = await makeDirectorCommandRepo(m.model).enqueue({
      sceneId: "s1",
      source: { kind: "operator", user: "op" },
      cmd: { op: "skip" },
      now: NOW,
      ttlMs: 60_000,
    });
    expect(out).toMatchObject({ sceneId: "s1", status: "queued", createdAt: NOW, expiresAt: NOW + 60_000 });
    expect(out.id).toEqual(expect.any(String));
    const doc = (m.create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(doc.purgeAt).toBeUndefined();
  });

  it("records a request refused at the door, ready to purge", async () => {
    const m = makeModel();
    const out = await makeDirectorCommandRepo(m.model).enqueue({
      sceneId: "s1",
      source: { kind: "operator", user: "op" },
      cmd: { op: "skip" },
      now: NOW,
      ttlMs: 60_000,
      status: "refused",
      note: "director is off",
    });
    expect(out).toMatchObject({ status: "refused", note: "director is off" });
    expect("purgeAt" in out).toBe(false);
    const doc = (m.create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(doc.purgeAt).toEqual(new Date(NOW + COMMAND_RETENTION_MS));
  });

  it("reads a scene's queued rows oldest first", async () => {
    const m = makeModel();
    m.exec.mockResolvedValue([{ _id: "x", __v: 0, id: "c1", status: "queued" }]);
    const out = await makeDirectorCommandRepo(m.model).pending("s1");
    expect(m.find).toHaveBeenCalledWith({ sceneId: "s1", status: "queued" });
    expect(m.sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(out).toEqual([{ id: "c1", status: "queued" }]);
  });

  it("settles only a row that is still queued", async () => {
    const m = makeModel();
    m.exec.mockResolvedValue({ modifiedCount: 1 });
    const ok = await makeDirectorCommandRepo(m.model).settle("c1", "applied", { now: NOW, appliedSeq: 4, note: undefined });
    expect(ok).toBe(true);
    expect(m.updateOne).toHaveBeenCalledWith(
      { id: "c1", status: "queued" },
      { $set: { status: "applied", purgeAt: new Date(NOW + COMMAND_RETENTION_MS), appliedSeq: 4 } },
    );
    m.exec.mockResolvedValue({ modifiedCount: 0 });
    expect(await makeDirectorCommandRepo(m.model).settle("c1", "applied", { now: NOW })).toBe(false);
  });

  it("clears a scene's queue as dropped", async () => {
    const m = makeModel();
    m.exec.mockResolvedValue({ modifiedCount: 3 });
    expect(await makeDirectorCommandRepo(m.model).clearQueued("s1", NOW)).toBe(3);
    expect(m.updateMany).toHaveBeenCalledWith(
      { sceneId: "s1", status: "queued" },
      { $set: { status: "dropped", note: "cleared", purgeAt: new Date(NOW + COMMAND_RETENTION_MS) } },
    );
  });

  it("reads the log newest first with a capped limit", async () => {
    const m = makeModel();
    m.exec.mockResolvedValue([]);
    await makeDirectorCommandRepo(m.model).recent("s1", { since: 10, limit: 9999 });
    expect(m.find).toHaveBeenCalledWith({ sceneId: "s1", createdAt: { $gt: 10 } });
    expect(m.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(m.limit).toHaveBeenCalledWith(200);
  });
});

describe("DirectorCommandSchema", () => {
  // Strict schema: a DirectorCommand field missing here is silently dropped.
  it("persists every DirectorCommand field", () => {
    const persisted = new Set(Object.keys(DirectorCommandSchema.paths).map((p) => p.split(".")[0]));
    for (const k of ["id", "sceneId", "source", "cmd", "status", "note", "resolved", "createdAt", "expiresAt", "appliedAt", "appliedSeq", "purgeAt"]) {
      expect([k, persisted.has(k)]).toEqual([k, true]);
    }
    for (const k of ["kind", "user", "platform", "author", "isMod", "job"]) {
      expect([k, `source.${k}` in DirectorCommandSchema.paths]).toEqual([k, true]);
    }
  });
});
