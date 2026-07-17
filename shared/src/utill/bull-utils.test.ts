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

  it("caps concurrency per tier (mid tightest — that's where the heavy ingests landed)", () => {
    // The live /status memory table showed cams/tracks (MID) as the heap hogs, not
    // the background bakes — so MID is the tighter lane.
    expect(TIER_CONCURRENCY).toEqual({ foreground: 2, mid: 2, background: 4 });
    expect(TIER_CONCURRENCY.mid).toBeLessThanOrEqual(TIER_CONCURRENCY.background);
  });
});

describe("queueForType", () => {
  it("routes heavy CPU/memory jobs to background", () => {
    for (const t of ["weather", "alertBlobs", "satimg", "aurora", "geomag", "areaWeather", "climate"]) {
      expect(queueForType(t)).toBe("background");
    }
  });

  it("routes latency-sensitive jobs to foreground", () => {
    expect(queueForType("director")).toBe("foreground");
    expect(queueForType("ping")).toBe("foreground");
  });

  it("falls back to mid (the default) for everything else", () => {
    expect(DEFAULT_TIER).toBe("mid");
    for (const t of ["alerts", "tracks", "cams", "tides", "notable", "seismo", "unknownType"]) {
      expect(queueForType(t)).toBe("mid");
    }
  });
});
