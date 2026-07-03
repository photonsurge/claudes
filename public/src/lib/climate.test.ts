import { parseClimateYear, bucketDaily, bucketValue, isoWeekStart } from "./climate";

const OM_BODY = {
  daily: {
    time: ["2025-08-30", "2025-08-31", "2025-09-01", "2025-09-02"],
    temperature_2m_mean: [21.5, 20.1, 20.0, 23.4],
    temperature_2m_max: [27.4, 24.1, 26.9, 30.1],
    temperature_2m_min: [16.4, 17.2, 13.8, 18.5],
    relative_humidity_2m_mean: [65, 63, null, 68],
    precipitation_sum: [0.0, 3.7, 1.8, 0.1],
    wind_speed_10m_max: [3.47, 6.36, 5.48, 4.76],
  },
};

describe("parseClimateYear", () => {
  it("maps every Open-Meteo daily field into a dataset, nulls preserved", () => {
    const year = parseClimateYear(51.5, -0.1, OM_BODY)!;
    expect(year.dates).toHaveLength(4);
    expect(year.datasets.map((d) => d.variable)).toEqual([
      "temp",
      "tempMax",
      "tempMin",
      "humidity",
      "rain",
      "wind",
    ]);
    const humidity = year.datasets.find((d) => d.variable === "humidity")!;
    expect(humidity.values).toEqual([65, 63, null, 68]);
  });

  it("rejects an empty/invalid payload", () => {
    expect(parseClimateYear(0, 0, {})).toBeNull();
    expect(parseClimateYear(0, 0, { daily: { time: [] } })).toBeNull();
  });
});

describe("isoWeekStart", () => {
  it("returns the Monday of the date's ISO week", () => {
    expect(isoWeekStart("2026-07-03")).toBe("2026-06-29"); // Friday → that Monday
    expect(isoWeekStart("2026-06-29")).toBe("2026-06-29"); // Monday stays
    expect(isoWeekStart("2026-07-05")).toBe("2026-06-29"); // Sunday belongs back
  });
});

describe("bucketDaily", () => {
  const dates = ["2025-08-30", "2025-08-31", "2025-09-01", "2025-09-02"];

  it("folds days into calendar months, skipping nulls", () => {
    const buckets = bucketDaily(dates, [10, 20, null, 40], "monthly");
    expect(buckets.map((b) => b.key)).toEqual(["2025-08", "2025-09"]);
    expect(buckets[0]).toMatchObject({ mean: 15, min: 10, max: 20, sum: 30, count: 2 });
    expect(buckets[1]).toMatchObject({ mean: 40, count: 1 });
  });

  it("folds days into ISO weeks (Sat+Sun+Mon+Tue span two weeks)", () => {
    const buckets = bucketDaily(dates, [1, 2, 3, 4], "weekly");
    // 30/31 Aug 2025 = Sat/Sun of the week starting Mon 25 Aug; 1/2 Sep next week.
    expect(buckets.map((b) => b.key)).toEqual(["2025-08-25", "2025-09-01"]);
    expect(buckets[0].sum).toBe(3);
    expect(buckets[1].sum).toBe(7);
  });
});

describe("bucketValue", () => {
  const b = { key: "2025-08", mean: 15, min: 10, max: 20, sum: 30, count: 2 };

  it("applies each dataset's natural fold", () => {
    expect(bucketValue("temp", b)).toBe(15); // mean
    expect(bucketValue("tempMax", b)).toBe(20); // max
    expect(bucketValue("tempMin", b)).toBe(10); // min
    expect(bucketValue("rain", b)).toBe(30); // sum
    expect(bucketValue("wind", b)).toBe(20); // max
    expect(bucketValue("humidity", b)).toBe(15); // mean
  });
});
