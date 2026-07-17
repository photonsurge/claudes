/**
 * clearOneQueue() unit tests — the per-queue purge logic (BullMQ silently refusing
 * to clean a job its schedule has armed, so schedules are dropped first). The
 * BullMQ Queue is a stub passed in directly; nothing here touches a real Redis.
 * clearQueue() itself just loops this over the three tiers — covered by one
 * aggregation test at the end.
 */
import { clearOneQueue, clearQueue, normalizeStates, type ClearableState } from "./bull";

type CleanCall = { grace: number; limit: number; state: string };

function stubQueue(over: Partial<Record<string, any>> = {}) {
  const calls: CleanCall[] = [];
  const q: any = {
    name: "worker-app",
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
  return { q, calls };
}

/** Run clearOneQueue with the same state-normalisation clearQueue applies. */
const clearOne = (q: any, states?: readonly string[], force = true) =>
  clearOneQueue(q, normalizeStates(states) as ClearableState[], force);

describe("clearOneQueue", () => {
  it("purges every job state with no age grace", async () => {
    const { q, calls } = stubQueue();

    const res = await clearOne(q);

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
    const { q } = stubQueue({
      clean: async (grace: number, limit: number, state: string) => {
        seen.push({ grace, limit, state });
        if (state !== "wait") return [];
        return new Array(batches[i++] ?? 0).fill("id");
      },
    });

    const res = await clearOne(q);

    expect(seen.filter((c) => c.state === "wait")).toHaveLength(3);
    expect(res.removed.wait).toBe(10_001);
  });

  it("cleans only the states asked for, folding waiting onto wait", async () => {
    const { q, calls } = stubQueue();

    const res = await clearOne(q, ["failed", "waiting"]);

    expect(calls.map((c) => c.state)).toEqual(["wait", "failed"]);
    expect(Object.keys(res.removed)).toEqual(["wait", "failed"]);
  });

  it("ignores unknown state names rather than passing them to clean()", async () => {
    const { q, calls } = stubQueue();

    await clearOne(q, ["failed", "bogus"]);

    expect(calls.map((c) => c.state)).toEqual(["failed"]);
  });
});

describe("clearOneQueue unarming", () => {
  // BullMQ guards a schedule's armed job: clean() skips it until the schedule is
  // gone. So the schedules must be dropped BEFORE the clean pass, or the clean
  // silently removes nothing.
  it("drops the schedules owning target jobs, before cleaning", async () => {
    const order: string[] = [];
    const { q } = stubQueue({
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

    const res = await clearOne(q, ["waiting"]);

    expect(order).toEqual(["unarm:abc", "clean:wait"]);
    expect(res.schedulers).toBe(1);
  });

  it("de-dupes schedules shared by several armed jobs", async () => {
    const unarmed: string[] = [];
    const { q } = stubQueue({
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

    const res = await clearOne(q, ["waiting"]);

    expect(unarmed).toEqual(["abc", "def"]);
    expect(res.schedulers).toBe(2);
  });

  it("falls back to the legacy repeatable API when removeJobScheduler throws", async () => {
    const unarmed: string[] = [];
    const { q } = stubQueue({
      getJobs: async () => [{ repeatJobKey: "abc" }],
      removeJobScheduler: async () => {
        throw new Error("not a job scheduler");
      },
      removeRepeatableByKey: async (key: string) => {
        unarmed.push(key);
        return true;
      },
    });

    const res = await clearOne(q, ["waiting"]);

    expect(unarmed).toEqual(["abc"]);
    expect(res.schedulers).toBe(1);
  });

  it("never unarms a schedule for a merely completed or failed run", async () => {
    // Those states aren't guarded by BullMQ, so dropping their schedule would
    // kill a live schedule for no reason. Don't even scan them.
    const unarmed: string[] = [];
    let scanned: unknown = null;
    const { q } = stubQueue({
      getJobs: async (states: string[]) => {
        scanned = states;
        return [{ repeatJobKey: "abc" }];
      },
      removeJobScheduler: async (key: string) => {
        unarmed.push(key);
        return true;
      },
    });

    const res = await clearOne(q, ["completed", "failed"]);

    expect(scanned).toBeNull();
    expect(unarmed).toEqual([]);
    expect(res.schedulers).toBe(0);
  });

  it("scans only the guarded states when the target mixes both", async () => {
    let scanned: unknown = null;
    const { q } = stubQueue({
      getJobs: async (states: string[]) => {
        scanned = states;
        return [];
      },
    });

    await clearOne(q, ["completed", "waiting", "delayed"]);

    expect(scanned).toEqual(["waiting", "delayed"]);
  });

  it("leaves schedules alone when force is off", async () => {
    const unarmed: string[] = [];
    const { q } = stubQueue({
      getJobs: async () => [{ repeatJobKey: "abc" }],
      removeJobScheduler: async (key: string) => {
        unarmed.push(key);
        return true;
      },
    });

    const res = await clearOne(q, undefined, false);

    expect(unarmed).toEqual([]);
    expect(res.schedulers).toBe(0);
  });
});

describe("clearQueue (tier aggregation)", () => {
  afterEach(() => {
    delete (global as any).__queues__;
  });

  it("sweeps all three tiers and sums what each removed", async () => {
    // Each tier's stub removes 2 'wait' jobs and unarms 1 schedule.
    const make = () => ({
      name: "q",
      waitUntilReady: async () => undefined,
      getJobs: async () => [{ repeatJobKey: "k" }],
      removeJobScheduler: async () => true,
      removeRepeatableByKey: async () => true,
      clean: async (_g: number, _l: number, state: string) => (state === "wait" ? ["a", "b"] : []),
    });
    (global as any).__queues__ = { foreground: make(), mid: make(), background: make() };

    const res = await clearQueue({ states: ["waiting"] });

    expect(res.removed.wait).toBe(6); // 2 per tier × 3 tiers
    expect(res.schedulers).toBe(3); // 1 per tier × 3 tiers
  });
});
