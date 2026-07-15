/**
 * clearQueue() unit tests — the BullMQ Queue is stubbed via the getQueue()
 * global singleton cache, so nothing here touches a real Redis.
 */
import { clearQueue } from "./bull";

type CleanCall = { grace: number; limit: number; state: string };

function stubQueue(over: Partial<Record<string, any>> = {}) {
  const calls: CleanCall[] = [];
  const q: any = {
    waitUntilReady: async () => undefined,
    clean: async (grace: number, limit: number, state: string) => {
      calls.push({ grace, limit, state });
      return [];
    },
    getJobSchedulers: async () => [],
    getRepeatableJobs: async () => [],
    removeJobScheduler: async () => true,
    removeRepeatableByKey: async () => true,
    ...over,
  };
  (global as any).__queue__ = q;
  return { q, calls };
}

afterEach(() => {
  delete (global as any).__queue__;
});

describe("clearQueue", () => {
  it("purges every job state with no age grace", async () => {
    const { calls } = stubQueue();

    const res = await clearQueue();

    expect(calls.map((c) => c.state)).toEqual([
      "active",
      "wait",
      "prioritized",
      "paused",
      "delayed",
      "failed",
      "completed",
    ]);
    expect(calls.every((c) => c.grace === 0)).toBe(true);
    expect(res.removed.failed).toBe(0);
    expect(res.schedulers).toBe(0);
  });

  it("keeps cleaning a state until a pass comes back short", async () => {
    // 5000 + 5000 + 1 waiting jobs: three passes, no cap at one batch.
    const batches = [5_000, 5_000, 1];
    let i = 0;
    const seen: CleanCall[] = [];
    stubQueue({
      clean: async (grace: number, limit: number, state: string) => {
        seen.push({ grace, limit, state });
        if (state !== "wait") return [];
        return new Array(batches[i++] ?? 0).fill("id");
      },
    });

    const res = await clearQueue();

    expect(seen.filter((c) => c.state === "wait")).toHaveLength(3);
    expect(res.removed.wait).toBe(10_001);
  });

  it("leaves repeatable schedules alone by default", async () => {
    const removed: string[] = [];
    stubQueue({
      getJobSchedulers: async () => [{ key: "summaries-daily" }],
      removeJobScheduler: async (key: string) => {
        removed.push(key);
        return true;
      },
    });

    const res = await clearQueue();

    expect(removed).toEqual([]);
    expect(res.schedulers).toBe(0);
  });

  it("removes schedulers when asked", async () => {
    const removed: string[] = [];
    stubQueue({
      getJobSchedulers: async () => [{ key: "summaries-daily" }, { key: "alerts-ingest" }],
      removeJobScheduler: async (key: string) => {
        removed.push(key);
        return true;
      },
    });

    const res = await clearQueue({ schedulers: true });

    expect(removed).toEqual(["summaries-daily", "alerts-ingest"]);
    expect(res.schedulers).toBe(2);
  });

  it("falls back to the legacy repeatable API when the scheduler API throws", async () => {
    const removed: string[] = [];
    stubQueue({
      getJobSchedulers: async () => {
        throw new Error("not supported");
      },
      getRepeatableJobs: async () => [{ key: "legacy:do:::60000" }],
      removeRepeatableByKey: async (key: string) => {
        removed.push(key);
        return true;
      },
    });

    const res = await clearQueue({ schedulers: true });

    expect(removed).toEqual(["legacy:do:::60000"]);
    expect(res.schedulers).toBe(1);
  });
});
