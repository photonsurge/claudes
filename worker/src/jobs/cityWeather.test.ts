import { rollupForecastDays } from "./cityWeather";

// 2026-07-11T00:00Z and 12:00Z, then next day — three 12h-spaced steps.
const D1 = Date.UTC(2026, 6, 11, 0, 0);
const H = 3_600_000;

describe("rollupForecastDays", () => {
  it("groups steps into daily hi/lo, max gust and summed rain", () => {
    const steps = [
      { t: D1, temp: 12, gust: 5, rain: 1 },
      { t: D1 + 12 * H, temp: 20, gust: 9, rain: 0 },
      { t: D1 + 24 * H, temp: 15, gust: 4, rain: 2 }, // next day
    ];
    const days = rollupForecastDays(steps);
    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({ date: "2026-07-11", hi: 20, lo: 12, gust: 9, rain: 1 });
    expect(days[1]).toEqual({ date: "2026-07-12", hi: 15, lo: 15, gust: 4, rain: 2 });
  });

  it("caps at maxDays and ignores null samples", () => {
    const steps = [
      { t: D1, temp: null, gust: null, rain: null },
      { t: D1 + 24 * H, temp: 10, gust: 3, rain: null },
      { t: D1 + 48 * H, temp: 11 },
      { t: D1 + 72 * H, temp: 9 },
    ];
    const days = rollupForecastDays(steps, 3);
    expect(days).toHaveLength(3);
    expect(days[0]).toEqual({ date: "2026-07-11" }); // all-null day → bare card
    expect(days[1]).toEqual({ date: "2026-07-12", hi: 10, lo: 10, gust: 3 });
  });

  it("treats negative rain as zero and never emits a negative accumulation", () => {
    const days = rollupForecastDays([{ t: D1, rain: -3 }, { t: D1 + H, rain: 4 }]);
    expect(days[0].rain).toBe(4);
  });
});
