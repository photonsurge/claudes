import { selectAreaWeather, selectPlaceHeadlines, hasAreaSignal } from "./areaContext";
import type { iAreaWeatherReportModel } from "@photonsurge/shared/db/area-weather-report-model";
import type { iPlaceRoundupModel } from "@photonsurge/shared/db/place-roundup-model";

const NOW = new Date("2026-07-11T12:00:00.000Z");

const areaReport = (over: Partial<iAreaWeatherReportModel>): iAreaWeatherReportModel =>
  ({
    id: "a",
    _id: "a",
    placeKind: "country",
    placeId: "p",
    name: "Placeland",
    generatedAt: new Date("2026-07-11T11:30:00.000Z"),
    stats: [],
    hazards: [],
    ...over,
  }) as iAreaWeatherReportModel;

const roundup = (over: Partial<iPlaceRoundupModel>): iPlaceRoundupModel =>
  ({
    id: "r",
    _id: "r",
    placeKind: "country",
    placeId: "p",
    name: "Placeland",
    generatedAt: new Date("2026-07-11T06:00:00.000Z"),
    narrative: "n",
    summary: "A calm day.",
    narrativeStatus: "ok",
    inputs: {},
    sections: {},
    cities: [],
    ...over,
  }) as unknown as iPlaceRoundupModel;

describe("selectAreaWeather", () => {
  it("keeps only fresh, hazard-flagged places ranked by severity", () => {
    const reports = [
      areaReport({ name: "Calm", hazards: [] }), // no hazard → dropped
      areaReport({
        name: "Spain",
        hazards: [{ hazard: "heat" as any, severityRank: 3, label: "Heat" }],
        stats: [{ variable: "temp", units: "°C", mean: 34, min: 28, max: 41.23, count: 100 }],
      }),
      areaReport({
        name: "North Sea",
        placeKind: "region",
        hazards: [{ hazard: "wind" as any, severityRank: 4, label: "High wind" }],
      }),
      areaReport({
        name: "Stale",
        generatedAt: new Date("2026-07-10T00:00:00.000Z"), // >6h → dropped
        hazards: [{ hazard: "heat" as any, severityRank: 4, label: "Heat" }],
      }),
    ];
    const out = selectAreaWeather(reports, NOW);
    expect(out.map((l) => l.name)).toEqual(["North Sea", "Spain"]); // sev 4 before sev 3, Stale/Calm gone
    expect(out[1].hazards).toEqual(["Heat"]);
    expect(out[1].stats[0].max).toBe(41.2); // rounded to 1dp
  });

  it("honours the cap", () => {
    const reports = Array.from({ length: 40 }, (_, i) =>
      areaReport({ name: `P${i}`, hazards: [{ hazard: "heat" as any, severityRank: 2, label: "Heat" }] }),
    );
    expect(selectAreaWeather(reports, NOW, 6, 25)).toHaveLength(25);
  });
});

describe("selectPlaceHeadlines", () => {
  it("keeps fresh round-ups with a real summary, newest first", () => {
    const roundups = [
      roundup({ name: "Japan", summary: "Typhoon nearing Okinawa.", generatedAt: new Date("2026-07-11T05:00:00.000Z") }),
      roundup({ name: "Empty", summary: "  ", generatedAt: new Date("2026-07-11T09:00:00.000Z") }), // no summary → dropped
      roundup({ name: "Old", summary: "Ancient.", generatedAt: new Date("2026-07-09T00:00:00.000Z") }), // >26h → dropped
      roundup({ name: "Chile", summary: "Cold snap easing.", generatedAt: new Date("2026-07-11T10:00:00.000Z") }),
    ];
    const out = selectPlaceHeadlines(roundups, NOW);
    expect(out.map((h) => h.name)).toEqual(["Chile", "Japan"]);
    expect(out[0].headline).toBe("Cold snap easing.");
  });
});

describe("hasAreaSignal", () => {
  it("is false for empty/absent context", () => {
    expect(hasAreaSignal(undefined)).toBe(false);
    expect(hasAreaSignal({ areaWeather: [], placeHeadlines: [] })).toBe(false);
  });
  it("is true when either list has entries", () => {
    expect(hasAreaSignal({ areaWeather: [{} as any], placeHeadlines: [] })).toBe(true);
  });
});
