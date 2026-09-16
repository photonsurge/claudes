import {
  bucketForecastDays,
  dayLabels,
  precipChanceFromSteps,
  deriveCondition,
  buildForecastDays,
  buildForecastSteps,
  buildAreaForecastDays,
  localDayOffsetHours,
  humanDayLabel,
  windDirection,
  compassPoint,
} from "./weather-forecast";
import type { ForecastPointSeries, ForecastAreaSeries } from "./worker-sample";
import type { AreaStats } from "@photonsurge/shared/weather/sample";

// The builders now COMPOSE day cards from the worker's pre-sampled series (no
// PNG decode). These helpers build those series directly from (isoTime, value)
// specs — decode/sample coverage lives in worker/src/weather/sampleService.test.

/** A sample spec: [time, value] for a scalar, [time, speed, u, v] for wind. */
type PtSample = [string, number] | [string, number, number, number];

function ptSeries(
  byVar: Record<string, PtSample[]>,
  units: Record<string, string> = { temp: "°C" },
): ForecastPointSeries {
  const samplesByVariable: ForecastPointSeries["samplesByVariable"] = {};
  const allValidTimes: Date[] = [];
  for (const [v, rows] of Object.entries(byVar)) {
    samplesByVariable[v] = rows.map(([iso, value, u, v2]) => {
      const t = new Date(iso);
      allValidTimes.push(t);
      return u != null && v2 != null ? { t, value, u, v: v2 } : { t, value };
    });
  }
  return { units, samplesByVariable, allValidTimes };
}

function areaSeries(
  byVar: Record<string, [string, AreaStats][]>,
  units: Record<string, string> = { temp: "°C" },
): ForecastAreaSeries {
  const samplesByVariable: Record<string, { t: Date; stats: AreaStats }[]> = {};
  const allValidTimes: Date[] = [];
  for (const [v, rows] of Object.entries(byVar)) {
    samplesByVariable[v] = rows.map(([iso, stats]) => {
      const t = new Date(iso);
      allValidTimes.push(t);
      return { t, stats };
    });
  }
  return { units, samplesByVariable, allValidTimes };
}

const flat = (v: number): AreaStats => ({ mean: v, min: v, max: v, count: 4 });

describe("localDayOffsetHours", () => {
  it("rounds longitude/15 to an hour offset", () => {
    expect(localDayOffsetHours(0)).toBe(0);
    expect(localDayOffsetHours(139)).toBe(9); // Tokyo-ish
    expect(localDayOffsetHours(-74)).toBe(-5); // NYC-ish
  });
});

describe("bucketForecastDays", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-06T00:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("labels today/tomorrow/+2/+3 in order", () => {
    const times = [
      new Date("2026-07-06T12:00:00Z"),
      new Date("2026-07-07T12:00:00Z"),
      new Date("2026-07-08T12:00:00Z"),
      new Date("2026-07-09T12:00:00Z"),
    ];
    const days = bucketForecastDays(times, 0);
    expect(days.map((d) => d.label)).toEqual(["TODAY", "TOMORROW", "+2", "+3"]);
  });

  it("drops days beyond the +3 window", () => {
    const times = [new Date("2026-07-06T00:00:00Z"), new Date("2026-07-11T00:00:00Z")];
    const days = bucketForecastDays(times, 0);
    expect(days.map((d) => d.date)).toEqual(["2026-07-06"]);
  });

  it("dedupes multiple steps landing in the same calendar day", () => {
    const times = [new Date("2026-07-06T00:00:00Z"), new Date("2026-07-06T09:00:00Z")];
    expect(bucketForecastDays(times, 0)).toHaveLength(1);
  });

  it("extends past +3 when a larger maxDays is requested (the daily outlook)", () => {
    const times = Array.from({ length: 10 }, (_, i) =>
      new Date(Date.parse("2026-07-06T12:00:00Z") + i * 86_400_000),
    );
    const days = bucketForecastDays(times, 0, 10);
    expect(days).toHaveLength(10);
    expect(days.map((d) => d.label)).toEqual([
      "TODAY", "TOMORROW", "+2", "+3", "+4", "+5", "+6", "+7", "+8", "+9",
    ]);
  });
});

describe("dayLabels", () => {
  it("labels TODAY/TOMORROW then +N up to the requested count", () => {
    expect(dayLabels(4)).toEqual(["TODAY", "TOMORROW", "+2", "+3"]);
    expect(dayLabels(1)).toEqual(["TODAY"]);
  });

  it("clamps to the 16-day store ceiling", () => {
    expect(dayLabels(999)).toHaveLength(16);
  });
});

describe("precipChanceFromSteps", () => {
  it("returns 0 for an empty series", () => {
    expect(precipChanceFromSteps([])).toBe(0);
  });

  it("rounds the hit-rate to the nearest 10", () => {
    expect(precipChanceFromSteps([0, 0, 0, 1])).toBe(30); // 1/4 = 25% -> 30
    expect(precipChanceFromSteps([1, 1, 1, 1])).toBe(100);
    expect(precipChanceFromSteps([0, 0, 0, 0])).toBe(0);
  });
});

describe("deriveCondition", () => {
  it("picks storm over anything else when a thunderstorm hazard fired", () => {
    expect(
      deriveCondition({
        tempMin: 20,
        rainMax: 0,
        cloudAvg: 0,
        hazards: [{ hazard: "thunderstorm", severityRank: 2, label: "SEVERE STORM RISK" }],
      }),
    ).toBe("storm");
  });

  it("picks snow when precip and freezing", () => {
    expect(deriveCondition({ tempMin: -2, rainMax: 1, cloudAvg: 50, hazards: [] })).toBe("snow");
  });

  it("picks rain when precip and above freezing", () => {
    expect(deriveCondition({ tempMin: 10, rainMax: 1, cloudAvg: 50, hazards: [] })).toBe("rain");
  });

  it("falls back to cloud cover tiers when dry", () => {
    expect(deriveCondition({ tempMin: 15, rainMax: 0, cloudAvg: 80, hazards: [] })).toBe("cloudy");
    expect(deriveCondition({ tempMin: 15, rainMax: 0, cloudAvg: 40, hazards: [] })).toBe(
      "partly-cloudy",
    );
    expect(deriveCondition({ tempMin: 15, rainMax: 0, cloudAvg: 5, hazards: [] })).toBe("sunny");
  });
});

describe("buildForecastDays", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-06T00:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("aggregates hi/lo temp and flags a hazard for an extreme day", async () => {
    const out = await buildForecastDays(
      ptSeries({ temp: [["2026-07-06T00:00:00Z", 0], ["2026-07-06T12:00:00Z", 60]] }),
      5,
      5,
    );
    expect(out.days).toHaveLength(1);
    const [today] = out.days;
    expect(today.label).toBe("TODAY");
    expect(today.loTemp).toBeCloseTo(0, 5);
    expect(today.hiTemp).toBeCloseTo(60, 5);
    expect(today.hazards.some((h) => h.hazard === "heat")).toBe(true);
    expect(today.condition).not.toBe("storm");
  });

  it("returns an empty days array when the series is empty", async () => {
    const out = await buildForecastDays(ptSeries({}), 50, 120);
    expect(out.days).toEqual([]);
  });

  it("carries the day's PEAK sustained wind alongside its mean", async () => {
    // A calm night and a blowy afternoon: the mean alone reads as a quiet day.
    const out = await buildForecastDays(
      ptSeries({
        wind: [
          ["2026-07-06T00:00:00Z", 1],
          ["2026-07-06T12:00:00Z", 15],
        ],
      }),
      5,
      5,
    );
    expect(out.days[0].windAvg).toBeCloseTo(8, 5);
    expect(out.days[0].windMax).toBeCloseTo(15, 5);
  });

  it("derives wind direction from the day's VECTOR mean", async () => {
    // Both steps blow due south (v negative) — i.e. a northerly, FROM 000.
    const out = await buildForecastDays(
      ptSeries({
        wind: [
          ["2026-07-06T00:00:00Z", 5, 0, -5],
          ["2026-07-06T12:00:00Z", 7, 0, -7],
        ],
      }),
      5,
      5,
    );
    expect(out.days[0].windDir).toBeCloseTo(0, 5);
    expect(compassPoint(out.days[0].windDir)).toBe("N");
  });

  it("cancels opposing flow to no direction rather than averaging bearings", async () => {
    const out = await buildForecastDays(
      ptSeries({
        wind: [
          ["2026-07-06T00:00:00Z", 6, 6, 0],
          ["2026-07-06T12:00:00Z", 6, -6, 0],
        ],
      }),
      5,
      5,
    );
    expect(out.days[0].windDir).toBeNull();
  });

  it("leaves direction null when the sampler sent no u/v (older worker)", async () => {
    const out = await buildForecastDays(ptSeries({ wind: [["2026-07-06T00:00:00Z", 6]] }), 5, 5);
    expect(out.days[0].windMax).toBeCloseTo(6, 5);
    expect(out.days[0].windDir).toBeNull();
  });
});

describe("windDirection / compassPoint", () => {
  it("reports the bearing the wind blows FROM", () => {
    expect(windDirection(0, -1)).toBeCloseTo(0, 5); // blowing south = northerly
    expect(windDirection(-1, 0)).toBeCloseTo(90, 5); // blowing west = easterly
    expect(windDirection(0, 1)).toBeCloseTo(180, 5); // blowing north = southerly
    expect(windDirection(1, 0)).toBeCloseTo(270, 5); // blowing east = westerly
  });

  it("has no direction for a dead calm", () => {
    expect(windDirection(0, 0)).toBeNull();
    expect(compassPoint(null)).toBeNull();
  });

  it("names the 16-point compass", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(45)).toBe("NE");
    expect(compassPoint(247)).toBe("WSW");
    expect(compassPoint(359)).toBe("N");
  });
});

describe("humanDayLabel", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-06T00:00:00Z")); // a Monday
  });
  afterEach(() => jest.useRealTimers());

  it("labels today/tomorrow by name and later days by weekday", () => {
    expect(humanDayLabel("2026-07-06", 0)).toBe("Today");
    expect(humanDayLabel("2026-07-07", 0)).toBe("Tomorrow");
    expect(humanDayLabel("2026-07-08", 0)).toBe("Wednesday");
    expect(humanDayLabel("2026-07-09", 0)).toBe("Thursday");
  });

  it("never returns a +N label", () => {
    expect(humanDayLabel("2026-07-08", 0)).not.toMatch(/\+/);
  });
});

describe("buildForecastSteps", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-06T00:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("keeps 3-hourly steps with per-step temp, labels, condition and hazards", async () => {
    const out = await buildForecastSteps(
      ptSeries({ temp: [["2026-07-06T00:00:00Z", 0], ["2026-07-06T03:00:00Z", 60]] }),
      5,
      5,
    );

    expect(out.steps).toHaveLength(2);
    expect(out.steps.map((s) => s.hourLabel)).toEqual(["00:00", "03:00"]);
    expect(out.steps.map((s) => s.dayLabel)).toEqual(["Today", "Today"]);
    expect(out.steps[0].temp).toBeCloseTo(0, 5);
    expect(out.steps[1].temp).toBeCloseTo(60, 5);
    expect(out.steps[1].hazards.some((h) => h.hazard === "heat")).toBe(true);
    expect(out.steps[1].condition).toBe("sunny");
  });

  it("applies the longitude local-hour offset to step labels", async () => {
    const out = await buildForecastSteps(
      ptSeries({ temp: [["2026-07-06T00:00:00Z", 0]] }),
      5,
      45,
    ); // round(45/15) = +3h offset
    expect(out.steps[0].hourLabel).toBe("03:00");
  });

  it("returns no steps when the series is empty", async () => {
    const out = await buildForecastSteps(ptSeries({}), 50, 120);
    expect(out.steps).toEqual([]);
  });
});

describe("buildAreaForecastDays", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-06T00:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("aggregates area mean/min/max per day", async () => {
    const out = await buildAreaForecastDays(
      areaSeries({ temp: [["2026-07-06T00:00:00Z", flat(0)]] }),
      [0, 0, 10, 10],
    );
    expect(out.days).toHaveLength(1);
    expect(out.days[0].temp?.mean).toBeCloseTo(0, 5);
  });
});
