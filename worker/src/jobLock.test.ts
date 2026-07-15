import { runExclusive, wasSkipped, __resetJobLocks } from "./jobLock";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe("runExclusive", () => {
  beforeEach(__resetJobLocks);

  it("runs the job and returns its result when the lock is free", async () => {
    const res = await runExclusive("volcano-media", "test", async () => ({ stored: 3 }));
    expect(res).toEqual({ stored: 3 });
    expect(wasSkipped(res)).toBe(false);
  });

  it("skips a second run while the first is still going — no pile-up", async () => {
    const gate = deferred();
    const first = runExclusive("volcano-media", "test", async () => { await gate.promise; return "first"; });

    const second = await runExclusive("volcano-media", "test", async () => "second");
    expect(wasSkipped(second)).toBe(true);
    expect((second as any).lock).toBe("volcano-media");

    gate.resolve();
    expect(await first).toBe("first");
  });

  it("different keys do not block each other", async () => {
    const gate = deferred();
    const first = runExclusive("volcano-media", "test", async () => { await gate.promise; return "first"; });
    const other = await runExclusive("weather", "test", async () => "other");

    expect(other).toBe("other");
    gate.resolve();
    await first;
  });

  it("releases the lock once the job finishes", async () => {
    await runExclusive("volcano-media", "test", async () => "one");
    expect(await runExclusive("volcano-media", "test", async () => "two")).toBe("two");
  });

  it("releases the lock when the job throws — a failure must not wedge the schedule", async () => {
    await expect(runExclusive("volcano-media", "test", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await runExclusive("volcano-media", "test", async () => "after")).toBe("after");
  });
});
