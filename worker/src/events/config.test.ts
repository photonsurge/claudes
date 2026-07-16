import { cadenceForRank, shouldPromoteAlert } from "./config";

/**
 * The cadence is a BUDGET, not a preference, and nothing encoded that — so it sat
 * 11x beyond the sweeper's throughput indefinitely and nobody could see it.
 *
 * Capacity is tick x batch and nothing else: 60 ticks/hour x 50 events per tick =
 * 3,000 acquires/hour. Demand is one acquire per event per cadence. If demand
 * exceeds capacity the queue never drains and an event's real cadence becomes
 * "however long the backlog is" — which was hours, unbounded, and worst for the
 * newest events. These tests fail if a future edit quietly reintroduces that.
 */
const TICKS_PER_HOUR = 60; // 60s tick
const BATCH = 50; // EVENT_WATCH_BATCH default
const CAPACITY_PER_HOUR = TICKS_PER_HOUR * BATCH;

/** Live population that qualifies for promotion (rank >= 3), measured. */
const LIVE_EVENTS = 1151;

const demandPerHour = (events: number, cadenceSec: number) => events * (3600 / cadenceSec);

describe("cadenceForRank is affordable", () => {
  it("keeps the live event population inside the sweeper's throughput", () => {
    // Orange is the bulk of it — 966 WMO + 183 MeteoAlarm at rank >= 3.
    const demand = demandPerHour(LIVE_EVENTS, cadenceForRank(3));

    expect(demand).toBeLessThan(CAPACITY_PER_HOUR);
  });

  it("the OLD cadence would not have fitted — this is the regression", () => {
    // 5 minutes: 13,812/hour against 1,200 of capacity. The queue sat 3,758 deep.
    expect(demandPerHour(LIVE_EVENTS, 300)).toBeGreaterThan(CAPACITY_PER_HOUR);
  });

  it("polls red harder than orange, and orange harder than a downgrade", () => {
    expect(cadenceForRank(4)).toBeLessThan(cadenceForRank(3));
    expect(cadenceForRank(3)).toBeLessThan(cadenceForRank(2));
  });

  it("red stays tight — there are only a handful, so it costs nothing", () => {
    expect(cadenceForRank(4)).toBeLessThanOrEqual(300);
  });

  it("is env-overridable without touching the code", () => {
    const prev = process.env.EVENT_CADENCE_ORANGE_SEC;
    process.env.EVENT_CADENCE_ORANGE_SEC = "900";
    expect(cadenceForRank(3)).toBe(900);
    if (prev === undefined) delete process.env.EVENT_CADENCE_ORANGE_SEC;
    else process.env.EVENT_CADENCE_ORANGE_SEC = prev;
  });
});

describe("shouldPromoteAlert watches the top two levels only", () => {
  it("promotes orange and red", () => {
    expect(shouldPromoteAlert({ maxSeverityRank: 3 })).toBe(true);
    expect(shouldPromoteAlert({ maxSeverityRank: 4 })).toBe(true);
  });

  it("ignores everything below — promoting minor advisories is what spawns thousands", () => {
    expect(shouldPromoteAlert({ maxSeverityRank: 2 })).toBe(false);
    expect(shouldPromoteAlert({ maxSeverityRank: 0 })).toBe(false);
  });
});
