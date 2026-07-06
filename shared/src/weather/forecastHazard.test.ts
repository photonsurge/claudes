import { classifyForecastDay } from "./forecastHazard";

describe("classifyForecastDay", () => {
  it("returns no flags for an unremarkable day", () => {
    expect(
      classifyForecastDay([
        { variable: "temp", min: 15, max: 22 },
        { variable: "gust", min: 2, max: 8 },
        { variable: "rain", min: 0, max: 1 },
      ]),
    ).toEqual([]);
  });

  it("flags high wind at the moderate and severe thresholds", () => {
    expect(classifyForecastDay([{ variable: "gust", min: 5, max: 23 }])).toEqual([
      { hazard: "wind", severityRank: 2, label: "HIGH WIND" },
    ]);
    expect(classifyForecastDay([{ variable: "gust", min: 5, max: 30 }])).toEqual([
      { hazard: "wind", severityRank: 3, label: "HIGH WIND" },
    ]);
  });

  it("flags extreme heat and extreme cold off temp min/max independently", () => {
    expect(classifyForecastDay([{ variable: "temp", min: 20, max: 41 }])).toEqual([
      { hazard: "heat", severityRank: 3, label: "EXTREME HEAT" },
    ]);
    expect(classifyForecastDay([{ variable: "temp", min: -30, max: -10 }])).toEqual([
      { hazard: "cold", severityRank: 3, label: "EXTREME COLD" },
    ]);
  });

  it("ignores variables with no matching rule", () => {
    expect(classifyForecastDay([{ variable: "cloud", min: 0, max: 100 }])).toEqual([]);
  });

  it("returns multiple simultaneous flags, most severe first", () => {
    const flags = classifyForecastDay([
      { variable: "gust", min: 5, max: 30 }, // rank 3
      { variable: "rain", min: 0, max: 12 }, // rank 2
    ]);
    expect(flags).toEqual([
      { hazard: "wind", severityRank: 3, label: "HIGH WIND" },
      { hazard: "rain", severityRank: 2, label: "HEAVY RAIN" },
    ]);
  });
});
