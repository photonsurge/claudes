// The schedule ticker and Run batch now (short-schedules.ts, docs/short-video-plan.md §8)
// against an in-memory db.shortSchedules; the render queue is mocked to record
// what a fire queues.

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

const queued: any[][] = [];
jest.mock("./render-queue", () => ({
  createRenders: jest.fn(async (reqs: any[], now: number) => {
    queued.push(reqs);
    return reqs.map((r, i) => ({ ...r, id: `r${queued.length}-${i}`, status: "queued", queuedAt: now + i }));
  }),
  advanceRenderQueues: jest.fn(async () => ({ started: [], settled: [], skipped: [] })),
}));

const schedules = new Map<string, any>();
const clone = <T>(x: T): T => (x == null ? x : structuredClone(x));
const formats: Record<string, any> = {
  europe: { id: "europe", video: { publishAs: "public" } },
  uk: { id: "uk", video: { publishAs: "unlisted" } },
};
const db = {
  shortSchedules: {
    get: jest.fn(async (id: string) => clone(schedules.get(id) ?? null)),
    due: jest.fn(async (now: number) =>
      [...schedules.values()].filter((s) => s.enabled && s.nextAt != null && s.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt).map(clone),
    ),
    claimFire: jest.fn(async (id: string, expect: number, patch: any, count: boolean) => {
      const s = schedules.get(id);
      if (!s || !s.enabled || s.nextAt !== expect) return null;
      Object.assign(s, clone(patch));
      if (count) s.fireCount += 1;
      return clone(s);
    }),
    countFire: jest.fn(async (id: string, lastFire: any) => {
      const s = schedules.get(id);
      if (!s) return null;
      s.fireCount += 1;
      s.lastFire = clone(lastFire);
      return clone(s);
    }),
  },
  shortFormats: { get: jest.fn(async (id: string) => clone(formats[id] ?? null)) },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { defaultShortSchedule, type ShortSchedule } from "@photonsurge/shared/short-schedule";
import { advanceRenderQueues } from "./render-queue";
import { batchRequests, runBatchNow, scheduleEnv, tickSchedules } from "./short-schedules";

const AT = Date.parse("2026-10-04T06:00:00Z"); // Sun 07:00 London
const MIN = 60_000;
const morning = (extra: Partial<ShortSchedule> = {}): ShortSchedule => ({
  ...defaultShortSchedule("morning", "Morning batch"),
  enabled: true,
  when: { type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "07:00", tz: "Europe/London" },
  encoderId: "obs-v1",
  fireCount: 213,
  nextAt: AT,
  videos: [
    { formatId: "europe", what: { type: "template", scope: { type: "area", id: "europe" } }, roundup: { maxAgeHours: 14, ifStale: "refresh" } },
    { formatId: "uk", what: { type: "template", scope: { type: "country", id: "uk" }, include: { alerts: true, quakes: false, volcanoes: false } }, roundup: { maxAgeHours: 14, ifStale: "skip" }, skipIfQuiet: true, video: { title: "UK #%{n}", publishAs: "private" } },
    { formatId: "europe", what: { type: "template", scope: { type: "auto", of: "area" } }, roundup: { maxAgeHours: 14, ifStale: "refresh" } },
  ],
  ...extra,
});
const put = (s: ShortSchedule) => schedules.set(s.id, clone(s));

beforeEach(() => {
  schedules.clear();
  queued.length = 0;
  jest.clearAllMocks();
});

describe("the ticker", () => {
  it("does nothing before a schedule's time", async () => {
    put(morning());
    expect(await tickSchedules(AT - 1)).toEqual({ fired: [], missed: [] });
    expect(queued).toEqual([]);
  });

  it("fires a due schedule: its batch queued in order as one batch, then the next time and the count", async () => {
    put(morning());
    const res = await tickSchedules(AT + 20_000);
    expect(res.fired).toHaveLength(1);
    expect(queued).toHaveLength(1);
    const [europe, uk, auto] = queued[0];
    const batchId = res.fired[0].batchId;
    expect(europe).toEqual({
      encoderId: "obs-v1",
      what: { type: "generate", formatId: "europe", scope: { type: "area", id: "europe" } },
      publishAs: "public", // the format's
      offline: false,
      roundup: { maxAgeHours: 14, ifStale: "refresh" },
      scheduleId: "morning",
      batchId,
      startBy: AT + 3_600_000, // the schedule's time + its start-by window
      n: 214,
    });
    expect(uk).toMatchObject({
      what: { type: "generate", formatId: "uk", scope: { type: "country", id: "uk" }, include: { alerts: true, quakes: false, volcanoes: false } },
      publishAs: "private", // the video's own override wins over its format
      video: { title: "UK #%{n}", publishAs: "private" },
      roundup: { maxAgeHours: 14, ifStale: "skip" },
      skipIfQuiet: true,
      batchId,
      n: 214,
    });
    expect(auto.what).toEqual({ type: "generate", formatId: "europe", scope: { type: "auto", of: "area" } });
    const s = schedules.get("morning");
    expect(s).toMatchObject({ enabled: true, fireCount: 214, nextAt: AT + 24 * 3_600_000, lastFire: { at: AT, batchId, outcome: "queued" } });
    expect(advanceRenderQueues).toHaveBeenCalled();
    // The same time never fires twice.
    expect((await tickSchedules(AT + 80_000)).fired).toEqual([]);
    expect(queued).toHaveLength(1);
  });

  it("a late fire inside the missed window still queues; start-by counts from the schedule's time", async () => {
    put(morning());
    const res = await tickSchedules(AT + 9 * MIN);
    expect(res.fired).toHaveLength(1);
    expect(queued[0][0].startBy).toBe(AT + 3_600_000);
    expect(schedules.get("morning").nextAt).toBe(AT + 24 * 3_600_000);
  });

  it("more than 10 minutes overdue: missed, nothing queued, the next time computed after now", async () => {
    // Powered off for three hours across two days' fires.
    put(morning({ nextAt: AT - 24 * 3_600_000 }));
    const now = AT + 3 * 3_600_000;
    const res = await tickSchedules(now);
    expect(res).toEqual({ fired: [], missed: ["morning"] });
    expect(queued).toEqual([]);
    expect(schedules.get("morning")).toMatchObject({
      enabled: true,
      fireCount: 213, // a miss is not a fire
      nextAt: AT + 24 * 3_600_000, // tomorrow 07:00 — not today's, already past
      lastFire: { at: AT - 24 * 3_600_000, outcome: "missed", note: expect.stringMatching(/1620 min late/) },
    });
    expect(advanceRenderQueues).not.toHaveBeenCalled();
  });

  it("the missed window is a deployment env", async () => {
    process.env.SHORT_SCHEDULE_MISSED_MS = String(30 * MIN);
    try {
      expect(scheduleEnv.missedWindowMs()).toBe(30 * MIN);
      put(morning());
      expect((await tickSchedules(AT + 20 * MIN)).fired).toHaveLength(1);
    } finally {
      delete process.env.SHORT_SCHEDULE_MISSED_MS;
    }
    expect(scheduleEnv.missedWindowMs()).toBe(10 * MIN);
  });

  it("a once schedule fires once and disables itself (and when missed, too)", async () => {
    put(morning({ id: "once", when: { type: "once", at: AT }, nextAt: AT }));
    put(morning({ id: "gone", when: { type: "once", at: AT - 3_600_000 }, nextAt: AT - 3_600_000 }));
    const res = await tickSchedules(AT + MIN);
    expect(res.fired.map((f) => f.scheduleId)).toEqual(["once"]);
    expect(res.missed).toEqual(["gone"]);
    expect(schedules.get("once")).toMatchObject({ enabled: false, nextAt: null, fireCount: 214, lastFire: { outcome: "queued" } });
    expect(schedules.get("gone")).toMatchObject({ enabled: false, nextAt: null, lastFire: { outcome: "missed" } });
    expect((await tickSchedules(AT + 2 * MIN)).fired).toEqual([]);
  });

  it("fires due schedules earliest first, and skips a disabled one", async () => {
    put(morning({ id: "b", nextAt: AT }));
    put(morning({ id: "a", nextAt: AT - MIN }));
    put(morning({ id: "off", enabled: false, nextAt: AT - MIN }));
    const res = await tickSchedules(AT + MIN);
    expect(res.fired.map((f) => f.scheduleId)).toEqual(["a", "b"]);
  });

  it("an edit between reading and claiming wins: nothing is queued for the old time", async () => {
    put(morning());
    db.shortSchedules.due.mockImplementationOnce(async () => {
      const read = clone(schedules.get("morning"));
      schedules.get("morning").nextAt = AT + 3_600_000; // the operator moved it to 08:00
      return [read];
    });
    expect((await tickSchedules(AT + MIN)).fired).toEqual([]);
    expect(queued).toEqual([]);
    expect(schedules.get("morning").nextAt).toBe(AT + 3_600_000);
  });

  it("carries the schedule's encoder, account and offline onto every video", async () => {
    put(morning({ encoderId: "any", accountId: "UC9", offline: true }));
    await tickSchedules(AT);
    for (const r of queued[0]) expect(r).toMatchObject({ encoderId: "any", accountId: "UC9", offline: true });
  });
});

describe("Run batch now", () => {
  it("queues the batch immediately without touching nextAt; it counts as a fire", async () => {
    put(morning({ enabled: false, nextAt: null }));
    const now = AT - 5 * 3_600_000;
    const res = await runBatchNow("morning", undefined, now);
    expect(res).toMatchObject({ ok: true, n: 214 });
    expect(queued[0].map((r: any) => r.publishAs)).toEqual(["public", "private", "public"]);
    expect(queued[0][0]).toMatchObject({ startBy: now + 3_600_000, n: 214, scheduleId: "morning" });
    expect(schedules.get("morning")).toMatchObject({ enabled: false, nextAt: null, fireCount: 214, lastFire: { at: now, outcome: "queued" } });
    expect(advanceRenderQueues).toHaveBeenCalled();
  });

  it("a publishAs override sets every video's privacy for this batch, over the format and the video's own", async () => {
    put(morning());
    const res = await runBatchNow("morning", "unlisted", AT - 3_600_000);
    expect(res.ok).toBe(true);
    expect(queued[0].map((r: any) => r.publishAs)).toEqual(["unlisted", "unlisted", "unlisted"]);
    // The video's own publishAs is dropped so it can't win at the front; the rest stays.
    expect(queued[0][1].video).toEqual({ title: "UK #%{n}" });
    expect(schedules.get("morning").nextAt).toBe(AT);
  });

  it("refuses an unknown schedule or an empty batch", async () => {
    expect(await runBatchNow("nope")).toEqual({ ok: false, error: "no such schedule" });
    put(morning({ videos: [] }));
    expect(await runBatchNow("morning")).toEqual({ ok: false, error: "the schedule has no videos" });
    expect(queued).toEqual([]);
  });
});

describe("batchRequests", () => {
  it("a script video queues that script; an unknown format's privacy is unlisted", () => {
    const s = morning({ videos: [{ formatId: "gone", what: { type: "script", scriptId: "s1" }, roundup: { maxAgeHours: 14, ifStale: "refresh" } }] });
    const [r] = batchRequests(s, { at: 1000, batchId: "b", n: 5, formatPublishAs: () => "unlisted" });
    expect(r).toMatchObject({ what: { type: "script", scriptId: "s1" }, publishAs: "unlisted", startBy: 1000 + 3_600_000, n: 5, batchId: "b" });
  });
});
