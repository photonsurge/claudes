import { makeEventWatchScheduleRepo, rescheduleStages } from "./event-watch-schedule-repo";

/**
 * `due()` decides which events get looked at, and ordering by `nextCheckAt` alone
 * is subtly backwards under load.
 *
 * Promotion starts a new event at `nextCheckAt = now`; a backlog item is overdue
 * from hours or days ago. Ascending order therefore puts "overdue since last
 * Tuesday" AHEAD of a red warning issued sixty seconds ago, and a new event waits
 * out the whole queue for its first look. Measured against a 3,758-deep backlog:
 * 103 events had never been acquired at all.
 */
const NOW = new Date("2026-07-16T02:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3600000);

/** Minimal find().sort().limit().lean().exec() chain over an in-memory list. */
const mkModel = (rows: any[]) => {
  const queries: any[] = [];
  const matches = (r: any, q: any) => {
    if (q.nextCheckAt?.$lte && !(r.nextCheckAt <= q.nextCheckAt.$lte)) return false;
    if (q.lastCheckedAt?.$in) return r.lastCheckedAt == null;
    if (q.lastCheckedAt?.$nin) return r.lastCheckedAt != null;
    return true;
  };
  const model = {
    find: (q: any) => {
      queries.push(q);
      let out = rows.filter((r) => matches(r, q));
      const chain: any = {
        sort: (s: any) => {
          const k = Object.keys(s)[0];
          out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * s[k]);
          return chain;
        },
        limit: (n: number) => {
          if (n > 0) out = out.slice(0, n);
          return chain;
        },
        lean: () => chain,
        exec: async () => out,
      };
      return chain;
    },
  } as any;
  return { model, queries };
};

const sched = (eventId: string, overdueH: number, lastCheckedAt: Date | null) => ({
  eventId,
  source: "wmo",
  nextCheckAt: ago(overdueH),
  lastCheckedAt,
  intervalSeconds: 1800,
});

describe("event-watch due() ordering", () => {
  it("gives a never-checked event its first look ahead of the stale backlog", () => {
    // The whole point: `new` is the least overdue by nextCheckAt, so a plain
    // ascending sort would serve it LAST despite being the interesting one.
    const { model } = mkModel([
      sched("stale-1", 72, ago(72)),
      sched("stale-2", 48, ago(48)),
      sched("new", 0.01, null),
    ]);
    const repo = makeEventWatchScheduleRepo(model);

    return repo.due(NOW, 2).then((out) => {
      expect(out.map((r) => r.eventId)).toEqual(["new", "stale-1"]);
    });
  });

  it("still rotates the established ones most-overdue first", async () => {
    const { model } = mkModel([
      sched("recent", 0.5, ago(0.5)),
      sched("oldest", 72, ago(72)),
      sched("middle", 10, ago(10)),
    ]);
    const repo = makeEventWatchScheduleRepo(model);

    const out = await repo.due(NOW, 3);

    expect(out.map((r) => r.eventId)).toEqual(["oldest", "middle", "recent"]);
  });

  it("never exceeds the batch, even when new events alone fill it", async () => {
    // The budget is tick x batch; phase 1 must not smuggle extra work past it.
    const { model } = mkModel([
      sched("n1", 0.1, null),
      sched("n2", 0.1, null),
      sched("n3", 0.1, null),
      sched("stale", 99, ago(99)),
    ]);
    const repo = makeEventWatchScheduleRepo(model);

    const out = await repo.due(NOW, 2);

    expect(out).toHaveLength(2);
    expect(out.every((r) => r.eventId.startsWith("n"))).toBe(true);
  });

  it("fills the rest of the batch from the backlog when new events are few", async () => {
    const { model } = mkModel([
      sched("new", 0.1, null),
      sched("stale-1", 50, ago(50)),
      sched("stale-2", 20, ago(20)),
    ]);
    const repo = makeEventWatchScheduleRepo(model);

    const out = await repo.due(NOW, 3);

    expect(out.map((r) => r.eventId)).toEqual(["new", "stale-1", "stale-2"]);
  });

  it("returns nothing that isn't due yet", async () => {
    const { model } = mkModel([
      { ...sched("future", 0, null), nextCheckAt: new Date(NOW.getTime() + 60000) },
    ]);
    const repo = makeEventWatchScheduleRepo(model);

    expect(await repo.due(NOW, 10)).toEqual([]);
  });
});

/**
 * `reschedule` writes aggregation stages so the backoff is computed server-side
 * from the document's own value — one round-trip instead of two, and an atomic
 * increment instead of a read-then-write that can lose one.
 *
 * The stages are arithmetic expressed as data. A wrong $pow or a missing $ifNull
 * doesn't throw; it schedules the next check at the wrong time, or never, and
 * nothing says so. Hence testing them directly.
 */
describe("rescheduleStages", () => {
  const NOW2 = new Date("2026-07-16T02:00:00Z");
  const set1 = (o: any) => o[0].$set;
  const set2 = (o: any) => o[1].$set;

  it("on success: plain cadence, failures cleared, success stamped", () => {
    const s = rescheduleStages({ intervalSeconds: 1800, ok: true }, NOW2, "new-id");

    expect(set1(s).intervalSeconds).toBe(1800);
    expect(set1(s).failureCount).toBe(0);
    expect(set1(s).lastSuccessAt).toBe(NOW2);
    // now + 1800s * 1000 * 1 — no backoff multiplier at all on success.
    expect(set2(s).nextCheckAt).toEqual({ $add: [NOW2, { $multiply: ["$intervalSeconds", 1000, 1] }] });
  });

  it("on failure: increments the count IN THE SERVER, not from a value we read", () => {
    // The race this closes: watch advances optimistically and acquire backs off on
    // failure, so two reschedules for one event can read the same count and lose
    // an increment — a broken source then never reaches its cap.
    const s = rescheduleStages({ ok: false }, NOW2, "new-id");

    expect(set1(s).failureCount).toEqual({ $add: [{ $ifNull: ["$failureCount", 0] }, 1] });
    expect(set1(s).lastSuccessAt).toBeUndefined();
  });

  it("on failure: backs off 2^failures, capped so a broken source is still retried", () => {
    const s = rescheduleStages({ ok: false }, NOW2, "new-id");

    expect(set2(s).nextCheckAt).toEqual({
      $add: [NOW2, { $multiply: ["$intervalSeconds", 1000, { $min: [{ $pow: [2, "$failureCount"] }, 8] }] }],
    });
  });

  it("keeps an existing id and mints one only on insert", () => {
    // A pipeline update has no $setOnInsert — this is how insert-only is spelled.
    expect(set1(rescheduleStages({ ok: true }, NOW2, "new-id")).id).toEqual({ $ifNull: ["$id", "new-id"] });
  });

  it("defaults the interval on insert rather than writing a null nextCheckAt", () => {
    // Every $field is null on insert. A null interval would make nextCheckAt null
    // — a schedule that is never due again, silently.
    expect(set1(rescheduleStages({ ok: true }, NOW2, "x")).intervalSeconds).toEqual({
      $ifNull: ["$intervalSeconds", 900],
    });
  });

  it("computes the backoff from the NEW failure count, not the stale one", () => {
    // Stage 2 reads what stage 1 set. If they were one stage, $failureCount in the
    // multiplier would still be the pre-increment value.
    const s = rescheduleStages({ ok: false }, NOW2, "x");
    expect(Object.keys(s[0])).toEqual(["$set"]);
    expect(Object.keys(s[1])).toEqual(["$set"]);
    expect(JSON.stringify(set2(s))).toContain("$failureCount");
  });
});

describe("reschedule", () => {
  it("uses ONE round-trip — no read before the write", async () => {
    const updateOne = jest.fn(() => ({ exec: async () => ({}) })) as jest.Mock;
    const findOne = jest.fn();
    const repo = makeEventWatchScheduleRepo({ updateOne, findOne } as any);

    await repo.reschedule("e1", "wmo", { ok: true, intervalSeconds: 1800 });

    expect(findOne).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0][0]).toEqual({ eventId: "e1", source: "wmo" });
    expect(Array.isArray(updateOne.mock.calls[0][1])).toBe(true); // a pipeline, not a $set doc
    expect(updateOne.mock.calls[0][2]).toEqual({ upsert: true });
  });
});
