import { SEED_SEA_POINTS } from "./director-sea-points";

describe("SEED_SEA_POINTS", () => {
  it("has unique ids and a name + blurb + valid framing for every point", () => {
    const ids = SEED_SEA_POINTS.map((p) => p.pointId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of SEED_SEA_POINTS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
      expect(p.lng).toBeGreaterThanOrEqual(-180);
      expect(p.lng).toBeLessThanOrEqual(180);
      expect(p.lat).toBeGreaterThanOrEqual(-90);
      expect(p.lat).toBeLessThanOrEqual(90);
      // Held-still regional shots, same ballpark as country framings.
      expect(p.zoom).toBeGreaterThanOrEqual(3);
      expect(p.zoom).toBeLessThanOrEqual(5.5);
      expect(p.enabled).toBe(true);
    }
  });

  it("flags exactly the real ocean-monitoring regions as depthCycle", () => {
    const depthCycleIds = SEED_SEA_POINTS.filter((p) => p.depthCycle).map((p) => p.pointId).sort();
    expect(depthCycleIds).toEqual(
      [
        "atlantic-mdr",
        "iod-east",
        "iod-west",
        "mediterranean",
        "nino-1-2",
        "nino-3",
        "nino-3-4",
        "nino-4",
        "north-sea",
      ].sort(),
    );
  });
});
