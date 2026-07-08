import { PNG } from "pngjs";
import {
  bucketForecastDays,
  precipChanceFromSteps,
  deriveCondition,
  buildForecastDays,
  buildForecastSteps,
  buildAreaForecastDays,
  localDayOffsetHours,
  humanDayLabel,
} from "./weather-forecast";
import type { iWeatherForecastFrameModel } from "@photonsurge/shared/db/weather-forecast-frame-model";

function scalarPng(width: number, height: number, byte: number): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    png.data[o] = byte;
    png.data[o + 1] = byte;
    png.data[o + 2] = byte;
    png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

let nextId = 0;
function frameOf(over: Partial<iWeatherForecastFrameModel> = {}): iWeatherForecastFrameModel {
  const id = `frame-${nextId++}`;
  return {
    id,
    _id: id,
    model: "gfs",
    variable: "temp",
    validTime: new Date("2026-07-06T00:00:00Z"),
    run: new Date("2026-07-06T00:00:00Z"),
    fhr: 0,
    encoding: "scalar",
    units: "°C",
    imageUnscale: [-90, 60],
    bounds: [0, 0, 10, 10],
    grid: { width: 2, height: 2, res: 10 },
    contentType: "image/png",
    data: scalarPng(2, 2, 153), // 0 °C
    byteSize: 0,
    ...over,
  } as iWeatherForecastFrameModel;
}

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
    const cold = frameOf({ validTime: new Date("2026-07-06T00:00:00Z"), data: scalarPng(2, 2, 153) }); // 0°C
    const hot = frameOf({
      validTime: new Date("2026-07-06T12:00:00Z"),
      data: scalarPng(2, 2, 255), // top of [-90,60] range = 60°C
    });
    const out = await buildForecastDays({ temp: [cold, hot] }, 5, 5);
    expect(out.days).toHaveLength(1);
    const [today] = out.days;
    expect(today.label).toBe("TODAY");
    expect(today.loTemp).toBeCloseTo(0, 5);
    expect(today.hiTemp).toBeCloseTo(60, 5);
    expect(today.hazards.some((h) => h.hazard === "heat")).toBe(true);
    expect(today.condition).not.toBe("storm");
  });

  it("returns an empty days array when nothing covers the point", async () => {
    const frame = frameOf();
    const out = await buildForecastDays({ temp: [frame] }, 50, 120);
    expect(out.days).toEqual([]);
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
    const s0 = frameOf({ validTime: new Date("2026-07-06T00:00:00Z"), data: scalarPng(2, 2, 153) }); // 0°C
    const s3 = frameOf({ validTime: new Date("2026-07-06T03:00:00Z"), data: scalarPng(2, 2, 255) }); // 60°C
    const out = await buildForecastSteps({ temp: [s0, s3] }, 5, 5);

    expect(out.steps).toHaveLength(2);
    expect(out.steps.map((s) => s.hourLabel)).toEqual(["00:00", "03:00"]);
    expect(out.steps.map((s) => s.dayLabel)).toEqual(["Today", "Today"]);
    expect(out.steps[0].temp).toBeCloseTo(0, 5);
    expect(out.steps[1].temp).toBeCloseTo(60, 5);
    expect(out.steps[1].hazards.some((h) => h.hazard === "heat")).toBe(true);
    expect(out.steps[1].condition).toBe("sunny");
  });

  it("applies the longitude local-hour offset to step labels", async () => {
    const frame = frameOf({
      validTime: new Date("2026-07-06T00:00:00Z"),
      bounds: [40, 0, 50, 10], // cover lng 45
      data: scalarPng(2, 2, 153),
    });
    const out = await buildForecastSteps({ temp: [frame] }, 5, 45); // round(45/15) = +3h offset
    expect(out.steps[0].hourLabel).toBe("03:00");
  });

  it("returns no steps when nothing covers the point", async () => {
    const frame = frameOf();
    const out = await buildForecastSteps({ temp: [frame] }, 50, 120);
    expect(out.steps).toEqual([]);
  });
});

describe("buildAreaForecastDays", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-06T00:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("aggregates area mean/min/max per day", async () => {
    const frame = frameOf({ validTime: new Date("2026-07-06T00:00:00Z"), data: scalarPng(2, 2, 153) });
    const out = await buildAreaForecastDays({ temp: [frame] }, [0, 0, 10, 10]);
    expect(out.days).toHaveLength(1);
    expect(out.days[0].temp?.mean).toBeCloseTo(0, 5);
  });
});
