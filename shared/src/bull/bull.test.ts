/**
 * clearQueue() unit tests — the BullMQ Queue is stubbed via the getQueue()
 * global singleton cache, so nothing here touches a real Redis. The end-to-end
 * behaviour these stubs stand in for (BullMQ silently refusing to clean a job
 * its schedule has armed) is verified against a live Redis separately.
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
    getJobs: async () => [],
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

  it("cleans only the states asked for, folding waiting onto wait", async () => {
    const { calls } = stubQueue();

    const res = await clearQueue({ states: ["failed", "waiting"] });

    expect(calls.map((c) => c.state)).toEqual(["wait", "failed"]);
    expect(Object.keys(res.removed)).toEqual(["wait", "failed"]);
  });

  it("ignores unknown state names rather than passing them to clean()", async () => {
    const { calls } = stubQueue();

    await clearQueue({ states: ["failed", "bogus"] });

    expect(calls.map((c) => c.state)).toEqual(["failed"]);
  });
});

describe("clearQueue unarming", () => {
  // BullMQ guards a schedule's armed job: clean() skips it until the schedule is
  // gone. So the schedules must be dropped BEFORE the clean pass, or the clean
  // silently removes nothing.
  it("drops the schedules owning target jobs, before cleaning", async () => {
    const order: string[] = [];
    stubQueue({
      getJobs: async () => [{ id: "repeat:abc:1", repeatJobKey: "abc" }, { id: "plain:1" }],
      removeJobScheduler: async (key: string) => {
        order.push(`unarm:${key}`);
        return true;
      },
      clean: async (_g: number, _l: number, state: string) => {
        order.push(`clean:${state}`);
        return [];
      },
    });

    const res = await clearQueue({ states: ["waiting"] });

    expect(order).toEqual(["unarm:abc", "clean:wait"]);
    expect(res.schedulers).toBe(1);
  });

  it("de-dupes schedules shared by several armed jobs", async () => {
    const unarmed: string[] = [];
    stubQueue({
      getJobs: async () => [
        { repeatJobKey: "abc" },
        { repeatJobKey: "abc" },
        { repeatJobKey: "def" },
      ],
      removeJobScheduler: async (key: string) => {
        unarmed.push(key);
        return true;
      },
    });

    const res = await clearQueue({ states: ["waiting"] });

    expect(unarmed).toEqual(["abc", "def"]);
    expect(res.schedulers).toBe(2);
  });

  it("falls back to the legacy repeatable API when removeJobScheduler throws", async () => {
    const unarmed: string[] = [];
    stubQueue({
      getJobs: async () => [{ repeatJobKey: "abc" }],
      removeJobScheduler: async () => {
        throw new Error("not a job scheduler");
      },
      removeRepeatableByKey: async (key: string) => {
        unarmed.push(key);
        return true;
      },
    });

    const res = await clearQueue({ states: ["waiting"] });

    expect(unarmed).toEqual(["abc"]);
    expect(res.schedulers).toBe(1);
  });

  it("never unarms a schedule for a merely completed or failed run", async () => {
    // Those states aren't guarded by BullMQ, so dropping their schedule would
    // kill a live schedule for no reason. Don't even scan them.
    const unarmed: string[] = [];
    let scanned: unknown = null;
    stubQueue({
      getJobs: async (states: string[]) => {
        scanned = states;
        return [{ repeatJobKey: "abc" }];
      },
      removeJobScheduler: async (key: string) => {
        unarmed.push(key);
        return true;
      },
    });

    const res = await clearQueue({ states: ["completed", "failed"] });

    expect(scanned).toBeNull();
    expect(unarmed).toEqual([]);
    expect(res.schedulers).toBe(0);
  });

  it("scans only the guarded states when the target mixes both", async () => {
    let scanned: unknown = null;
    stubQueue({
      getJobs: async (states: string[]) => {
        scanned = states;
        return [];
      },
    });

    await clearQueue({ states: ["completed", "waiting", "delayed"] });

    expect(scanned).toEqual(["waiting", "delayed"]);
  });

  it("leaves schedules alone when force is off", async () => {
    const unarmed: string[] = [];
    stubQueue({
      getJobs: async () => [{ repeatJobKey: "abc" }],
      removeJobScheduler: async (key: string) => {
        unarmed.push(key);
        return true;
      },
    });

    const res = await clearQueue({ force: false });

    expect(unarmed).toEqual([]);
    expect(res.schedulers).toBe(0);
  });
});
