import { makeEventWatchScheduleRepo } from "./event-watch-schedule-repo";

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
