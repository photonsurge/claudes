import { NEUTRAL_MOOD, latestReading, moodFrom, weatherFromSeries } from "./weather";

describe("moodFrom", () => {
  it("is neutral with no readings", () => {
    expect(moodFrom({})).toEqual(NEUTRAL_MOOD);
    expect(moodFrom({ wind: null, rain: null, temp: null, kp: null })).toEqual(NEUTRAL_MOOD);
  });

  it("maps calm/wet/cold/quiet-sky readings onto the axes", () => {
    const m = moodFrom({ wind: 7, rain: 1.5, temp: 12.5, kp: 4.5 });
    expect(m.windy).toBeCloseTo(0.5);
    expect(m.wet).toBeCloseTo(0.5);
    expect(m.warm).toBeCloseTo(0.5);
    expect(m.aurora).toBeCloseTo(0.5);
  });

  it("saturates at a gale, heavy rain, heat and a storm-level Kp", () => {
    expect(moodFrom({ wind: 30, rain: 12, temp: 40, kp: 9 })).toEqual({ windy: 1, wet: 1, warm: 1, aurora: 1 });
    expect(moodFrom({ wind: 0, rain: 0, temp: -20, kp: 1 })).toEqual({ windy: 0, wet: 0, warm: 0, aurora: 0 });
  });

  it("lets a gust stand in for the wind", () => {
    expect(moodFrom({ wind: 2, gust: 20 }).windy).toBeCloseTo(1);
  });
});

describe("weatherFromSeries", () => {
  const series = [
    { variable: "wind", units: "m/s", series: [{ speed: 3 }, { speed: 9 }, {}] },
    { variable: "gust", units: "km/h", series: [{ value: 36 }] },
    { variable: "rain", units: "mm/h", series: [{ value: 0.2 }, { value: 2.4 }] },
    { variable: "temp", units: "K", series: [{ value: 293.15 }] },
    { variable: "pressure", units: "hPa", series: [{ value: 1012 }] },
  ];

  it("takes the latest numeric point per variable and normalises units", () => {
    expect(latestReading(series, "wind")).toEqual({ v: 9, units: "m/s" });
    expect(latestReading(series, "cloud")).toBeNull();
    const w = weatherFromSeries(series, 6);
    expect(w.wind).toBe(9);
    expect(w.gust).toBeCloseTo(10);
    expect(w.rain).toBe(2.4);
    expect(w.temp).toBeCloseTo(20);
    expect(w.kp).toBe(6);
  });

  it("returns nulls for missing variables", () => {
    expect(weatherFromSeries([], null)).toEqual({ wind: null, gust: null, rain: null, temp: null, kp: null });
  });
});
