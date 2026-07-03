import {
  hazardMapPlan,
  DEFAULT_STORM_PLAN,
  DEFAULT_CYCLE_MS,
} from "./hazard-director";
import { HAZARDS, type HazardType } from "./hazard";

describe("hazardMapPlan", () => {
  it("opens a heat warning on humidity (heat-index context)", () => {
    expect(hazardMapPlan("heat").cycle[0]).toBe("humidity");
  });

  it("reads a tornado through CAPE → radar → gust and cuts quicker", () => {
    const p = hazardMapPlan("tornado");
    expect(p.cycle).toEqual(["storm", "rain", "gust"]);
    expect(p.cycleMs).toBeLessThan(DEFAULT_CYCLE_MS);
  });

  it("falls back to the storm plan for geophysical / unknown hazards", () => {
    expect(hazardMapPlan("tsunami")).toEqual(DEFAULT_STORM_PLAN);
    expect(hazardMapPlan("other")).toEqual(DEFAULT_STORM_PLAN);
    expect(hazardMapPlan(undefined)).toEqual(DEFAULT_STORM_PLAN);
  });

  it("resolves a full, non-empty plan for every hazard in the vocabulary", () => {
    for (const { id } of HAZARDS) {
      const p = hazardMapPlan(id as HazardType);
      expect(p.cycle.length).toBeGreaterThan(0);
      expect(p.cycleMs).toBeGreaterThan(0);
    }
  });
});
