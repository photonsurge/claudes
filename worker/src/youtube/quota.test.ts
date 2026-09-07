/**
 * Quota meter: Pacific-day arithmetic (the reset boundary), the chat pacing rule,
 * and the store round-trip on the in-memory backend.
 */
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => ({})) }));

import {
  CHAT_PAUSE_MAX_MS,
  MemoryQuotaStore,
  chatPacing,
  chatPacingFor,
  clearExhausted,
  dailyBudget,
  exhaustedUntil,
  markExhausted,
  nextPacificMidnight,
  pacificDayKey,
  quotaCost,
  quotaSnapshot,
  setQuotaStore,
  spend,
  spentToday,
} from "./quota";

const T = (iso: string) => new Date(iso).getTime();

beforeEach(() => {
  setQuotaStore(new MemoryQuotaStore());
  delete process.env.YOUTUBE_QUOTA_DAILY;
  delete process.env.YOUTUBE_QUOTA_COST_CHAT_LIST;
});

describe("Pacific day boundary", () => {
  it("summer (PDT, UTC-7): the reset is 07:00Z", () => {
    expect(pacificDayKey(T("2026-09-07T12:00:00Z"))).toBe("2026-09-07");
    expect(nextPacificMidnight(T("2026-09-07T12:00:00Z"))).toBe(T("2026-09-08T07:00:00Z"));
  });
  it("late UTC evening is still the same Pacific day", () => {
    expect(pacificDayKey(T("2026-09-08T03:00:00Z"))).toBe("2026-09-07");
    expect(nextPacificMidnight(T("2026-09-08T03:00:00Z"))).toBe(T("2026-09-08T07:00:00Z"));
  });
  it("winter (PST, UTC-8): the reset is 08:00Z", () => {
    expect(pacificDayKey(T("2026-01-15T12:00:00Z"))).toBe("2026-01-15");
    expect(nextPacificMidnight(T("2026-01-15T12:00:00Z"))).toBe(T("2026-01-16T08:00:00Z"));
  });
  it("across the autumn DST switch (1 Nov 2026) the next midnight lands on the new offset", () => {
    // 01:30 PDT on switch day → next midnight is 00:00 PST = 08:00Z on 2 Nov.
    expect(nextPacificMidnight(T("2026-11-01T08:30:00Z"))).toBe(T("2026-11-02T08:00:00Z"));
    // The evening before: midnight is still on PDT.
    expect(nextPacificMidnight(T("2026-11-01T06:00:00Z"))).toBe(T("2026-11-01T07:00:00Z"));
  });
});

describe("chat pacing rule", () => {
  const day = 24 * 3_600_000;
  const base = { spent: 0, budget: 10_000, reserve: 1_500, share: 0.6, costPerPoll: 5, now: 0, resetAt: day };

  it("spreads the chat share of the remaining budget over the day and the live runs", () => {
    // (10000 − 1500) × 0.6 / 5 = 1020 polls → one every ~85 s
    expect(chatPacingFor({ ...base, liveChatRuns: 1 })).toEqual({ floorMs: Math.ceil(day / 1020) });
    // three runs share it → 340 polls each
    expect(chatPacingFor({ ...base, liveChatRuns: 3 })).toEqual({ floorMs: Math.ceil(day / 340) });
  });

  it("speeds up as the budget grows and slows as the day is spent", () => {
    const big = chatPacingFor({ ...base, budget: 1_000_000, liveChatRuns: 1 }).floorMs;
    expect(big).toBeLessThan(1_000); // a raised quota lets YouTube's own 2–5 s cadence win
    const late = chatPacingFor({ ...base, spent: 8_000, liveChatRuns: 1 }).floorMs;
    expect(late).toBeGreaterThan(chatPacingFor({ ...base, liveChatRuns: 1 }).floorMs);
  });

  it("pauses (capped) once only the lifecycle reserve is left", () => {
    const p = chatPacingFor({ ...base, spent: 8_600, liveChatRuns: 1 });
    expect(p.pauseMs).toBe(CHAT_PAUSE_MAX_MS);
    expect(p.floorMs).toBe(day);
  });
});

describe("meter store", () => {
  // The memory store expires entries by the REAL clock, so these run relative to now.
  const now = Date.now();

  it("accumulates units per account per Pacific day", async () => {
    await spend("chan", "liveChatMessages.list", now);
    await spend("chan", "liveStreams.list", now);
    expect(await spentToday("chan", now)).toBe(quotaCost("liveChatMessages.list") + 1);
    expect(await spentToday("other", now)).toBe(0);
    // A new Pacific day is a fresh bucket.
    expect(await spentToday("chan", now + 2 * 24 * 3_600_000)).toBe(0);
  });

  it("remembers an exhausted verdict until the reset", async () => {
    expect(await exhaustedUntil("chan", now)).toBeNull();
    const until = nextPacificMidnight(now);
    await markExhausted("chan", until);
    expect(await exhaustedUntil("chan", now)).toBe(until);
    expect(await exhaustedUntil("chan", until + 1)).toBeNull();
    await clearExhausted("chan");
    expect(await exhaustedUntil("chan", now)).toBeNull();
  });

  it("snapshot + pacing honour the env budget and a live block", async () => {
    process.env.YOUTUBE_QUOTA_DAILY = "50000";
    expect(dailyBudget()).toBe(50_000);
    const snap = await quotaSnapshot("chan", now);
    expect(snap).toMatchObject({ budget: 50_000, spent: 0, remaining: 50_000, exhaustedUntil: null });
    expect(snap.resetAt).toBe(nextPacificMidnight(now));
    await markExhausted("chan", now + 3_600_000);
    const pacing = await chatPacing("chan", 1, now);
    expect(pacing.pauseMs).toBe(CHAT_PAUSE_MAX_MS);
    expect(pacing.floorMs).toBe(3_600_000);
  });

  it("the chat list cost is env-overridable (Google's tables have varied)", () => {
    expect(quotaCost("liveChatMessages.list")).toBe(5);
    process.env.YOUTUBE_QUOTA_COST_CHAT_LIST = "1";
    expect(quotaCost("liveChatMessages.list")).toBe(1);
  });
});
