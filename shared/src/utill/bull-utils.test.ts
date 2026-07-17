import {
  QUEUE_TIERS,
  QUEUE_NAMES,
  TIER_CONCURRENCY,
  DEFAULT_TIER,
  queueForType,
} from "./bull-utils";

describe("queue tiers", () => {
  it("has a distinct queue name per tier, mid keeping the historical name", () => {
    const names = QUEUE_TIERS.map((t) => QUEUE_NAMES[t]);
    expect(new Set(names).size).toBe(QUEUE_TIERS.length);
    expect(QUEUE_NAMES.mid).toBe("worker-app"); // unchanged → existing schedules/readers survive
  });

  it("caps concurrency per tier (background widest given host headroom, foreground tightest)", () => {
    // With Mongo's cache capped there's RAM to run BACKGROUND wider (the heavy
    // hogs + throughput lane); MID runs the light ingests; FOREGROUND stays lowest.
    expect(TIER_CONCURRENCY).toEqual({ foreground: 2, mid: 3, background: 4 });
    expect(TIER_CONCURRENCY.foreground).toBeLessThanOrEqual(TIER_CONCURRENCY.mid);
    expect(TIER_CONCURRENCY.mid).toBeLessThanOrEqual(TIER_CONCURRENCY.background);
  });
});

describe("queueForType", () => {
  it("routes heavy CPU/memory jobs to background", () => {
    // alerts + tracks are here off the live /status ledger (ingest +765MB, aircraft
    // enrich +743MB) — the biggest heap hogs, previously defaulting into mid.
    for (const t of ["weather", "alertBlobs", "alerts", "tracks", "satimg", "aurora", "geomag", "areaWeather", "climate"]) {
      expect(queueForType(t)).toBe("background");
    }
  });

  it("routes latency-sensitive jobs to foreground", () => {
    expect(queueForType("director")).toBe("foreground");
    expect(queueForType("ping")).toBe("foreground");
  });

  it("falls back to mid (the default) for everything else", () => {
    expect(DEFAULT_TIER).toBe("mid");
    for (const t of ["cams", "tides", "notable", "seismo", "faults", "cables", "unknownType"]) {
      expect(queueForType(t)).toBe("mid");
    }
  });
});
