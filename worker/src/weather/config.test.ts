import { cfg, forecastSteps, bakeSteps, runDateFor } from "./config";

describe("forecastSteps", () => {
  it("enumerates f000..forecastHours inclusive by stepHours", () => {
    expect(forecastSteps(12, 3)).toEqual([0, 3, 6, 9, 12]);
  });

  it("includes the endpoint only when it lands on a step", () => {
    // 10 by 3 -> 0,3,6,9 (10 not divisible by 3, last <=10 is 9)
    expect(forecastSteps(10, 3)).toEqual([0, 3, 6, 9]);
  });

  it("returns just [0] when forecastHours is 0", () => {
    expect(forecastSteps(0, 3)).toEqual([0]);
  });

  it("floors a zero step to 1 to avoid an infinite loop", () => {
    expect(forecastSteps(3, 0)).toEqual([0, 1, 2, 3]);
  });

  it("floors a negative step to 1", () => {
    expect(forecastSteps(2, -5)).toEqual([0, 1, 2]);
  });

  it("handles a step larger than the horizon (just f000)", () => {
    expect(forecastSteps(3, 6)).toEqual([0]);
  });

  it("matches the production default (72h / 3h = 25 steps)", () => {
    const steps = forecastSteps(72, 3);
    expect(steps).toHaveLength(25);
    expect(steps[0]).toBe(0);
    expect(steps[steps.length - 1]).toBe(72);
  });
});

describe("runDateFor", () => {
  it("builds a UTC Date from YYYYMMDD + HH cycle", () => {
    expect(runDateFor("20260628", "06").toISOString()).toBe("2026-06-28T06:00:00.000Z");
  });

  it("handles the 00 cycle", () => {
    expect(runDateFor("20260101", "00").toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("handles the 18 cycle and end-of-month date", () => {
    expect(runDateFor("20260131", "18").toISOString()).toBe("2026-01-31T18:00:00.000Z");
  });

  it("parses a single-character cycle string", () => {
    expect(runDateFor("20260628", "6").toISOString()).toBe("2026-06-28T06:00:00.000Z");
  });
});

describe("cfg", () => {
  const HARDCODED = {
    model: "gfs",
    forecastHours: 72,
    stepHours: 3,
    retainRuns: 3,
    dailyHours: 384,
    dailyStepHours: 12,
  };

  it("returns the hardcoded production config", () => {
    expect(cfg()).toEqual(HARDCODED);
  });

  it("ignores environment overrides (config is hardcoded, not env-driven)", () => {
    process.env.MODEL = "gefs";
    process.env.FORECAST_HOURS = "999";
    process.env.STEP_HOURS = "6";
    process.env.RETAIN_RUNS = "10";
    try {
      expect(cfg()).toEqual(HARDCODED);
    } finally {
      delete process.env.MODEL;
      delete process.env.FORECAST_HOURS;
      delete process.env.STEP_HOURS;
      delete process.env.RETAIN_RUNS;
    }
  });
});

describe("bakeSteps", () => {
  it("keeps the full detailed 3-hourly track out to 72h", () => {
    const steps = bakeSteps(cfg());
    for (const f of forecastSteps(72, 3)) expect(steps).toContain(f);
  });

  it("adds the 12-hourly daily outlook out to the 384h GFS ceiling", () => {
    const steps = bakeSteps(cfg());
    expect(steps).toContain(84);
    expect(steps).toContain(240);
    expect(steps[steps.length - 1]).toBe(384);
  });

  it("emits no >72h step that is not a 12-hour multiple", () => {
    const steps = bakeSteps(cfg());
    expect(steps.filter((f) => f > 72 && f % 12 !== 0)).toEqual([]);
  });

  it("is sorted ascending with no duplicates across the union boundary", () => {
    const steps = bakeSteps(cfg());
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(new Set(steps).size).toBe(steps.length);
  });
});
