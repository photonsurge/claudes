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

  it("caps concurrency per tier (mid widest for light I/O ingests, background held low for heap)", () => {
    // MID = many network-bound cron ingests → runs widest; BACKGROUND = heap-heavy
    // bakes → held low (its cap bounds memory); FOREGROUND tightest for latency.
    expect(TIER_CONCURRENCY).toEqual({ foreground: 2, mid: 4, background: 3 });
    expect(TIER_CONCURRENCY.foreground).toBeLessThanOrEqual(TIER_CONCURRENCY.background);
    expect(TIER_CONCURRENCY.background).toBeLessThanOrEqual(TIER_CONCURRENCY.mid);
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
