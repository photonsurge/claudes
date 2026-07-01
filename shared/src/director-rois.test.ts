import { quakeMapPlan, QUAKE_TSUNAMI_PLAN, QUAKE_LAND_PLAN } from "./director-rois";

describe("quakeMapPlan", () => {
  it("reads the ocean story (sst → wave) for a tsunami-flagged quake", () => {
    expect(quakeMapPlan(true)).toBe(QUAKE_TSUNAMI_PLAN);
    expect(quakeMapPlan(true).cycle[0]).toBe("sst");
  });

  it("reads a neutral temp/sst backdrop for an ordinary quake", () => {
    expect(quakeMapPlan(false)).toBe(QUAKE_LAND_PLAN);
    expect(quakeMapPlan(undefined)).toBe(QUAKE_LAND_PLAN);
    expect(quakeMapPlan().cycle[0]).toBe("temp");
  });

  it("never shows meteorological fields over a quake", () => {
    const meteo = new Set(["humidity", "rain", "gust", "storm"]);
    for (const plan of [QUAKE_TSUNAMI_PLAN, QUAKE_LAND_PLAN]) {
      for (const v of plan.cycle) expect(meteo.has(v)).toBe(false);
    }
  });
});
