import { areaWeatherSeries } from "./area-weather";
import type { iAreaWeatherReportModel } from "@photonsurge/shared/db/area-weather-report-model";

// Repo returns snapshots newest-first; the chart series must read oldest→newest.
const history = [
  { generatedAt: "2026-07-10T02:00:00Z", stats: [{ variable: "temp", units: "°C", mean: 16, min: 12, max: 20, count: 5 }], hazards: [] },
  { generatedAt: "2026-07-10T01:00:00Z", stats: [{ variable: "temp", units: "°C", mean: 14, min: 10, max: 18, count: 5 }], hazards: [] },
] as unknown as iAreaWeatherReportModel[];

it("reverses history into oldest-first series with an average", () => {
  const series = areaWeatherSeries(history);
  expect(series).toHaveLength(1);
  expect(series[0].variable).toBe("temp");
  expect(series[0].label).toBe("TEMPERATURE");
  expect(series[0].units).toBe("°C");
  expect(series[0].points.map((p) => p.value)).toEqual([14, 16]);
  expect(series[0].avg).toBe(15);
  expect(series[0].caption).toContain("avg 15");
});

it("returns no series for empty history", () => {
  expect(areaWeatherSeries([])).toEqual([]);
});
