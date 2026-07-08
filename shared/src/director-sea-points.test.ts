import {
  SEA_POINTS,
  seaPointShot,
  DEFAULT_SEA_POINTS,
  sanitizeDirectorSeaPoints,
} from "./director-sea-points";

describe("SEA_POINTS catalog", () => {
  it("has unique ids and a name + blurb + framing for every point", () => {
    const ids = SEA_POINTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of SEA_POINTS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
      expect(p.center[0]).toBeGreaterThanOrEqual(-180);
      expect(p.center[0]).toBeLessThanOrEqual(180);
      expect(p.center[1]).toBeGreaterThanOrEqual(-90);
      expect(p.center[1]).toBeLessThanOrEqual(90);
      // Held-still regional shots, same ballpark as country/tour framings.
      expect(p.zoom).toBeGreaterThanOrEqual(3);
      expect(p.zoom).toBeLessThanOrEqual(5.5);
    }
  });

  it("looks up by id and misses unknowns", () => {
    expect(seaPointShot("gulf-stream")?.name).toBe("Gulf Stream");
    expect(seaPointShot("nope")).toBeUndefined();
  });
});

describe("DEFAULT_SEA_POINTS", () => {
  it("enables every catalog entry by default", () => {
    expect(DEFAULT_SEA_POINTS).toEqual(SEA_POINTS.map((p) => p.id));
  });
});

describe("sanitizeDirectorSeaPoints", () => {
  it("rejects non-arrays (merge keeps the base)", () => {
    expect(sanitizeDirectorSeaPoints(undefined)).toBeNull();
    expect(sanitizeDirectorSeaPoints("gulf-stream")).toBeNull();
    expect(sanitizeDirectorSeaPoints({ "gulf-stream": true })).toBeNull();
  });

  it("keeps only known ids, deduped, in catalog order", () => {
    expect(
      sanitizeDirectorSeaPoints(["mariana-trench", "atlantis", "gulf-stream", "mariana-trench", 42]),
    ).toEqual(["gulf-stream", "mariana-trench"]);
  });

  it("allows an empty favourites list", () => {
    expect(sanitizeDirectorSeaPoints([])).toEqual([]);
  });
});
