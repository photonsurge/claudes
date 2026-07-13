import { parseGvpCatalog, nearestGvp } from "./gvp-catalog";

const SAMPLE = [
  { vnum: "241100", vName: "Ruapehu", country: "New Zealand", latitude: -39.28, longitude: 175.57, elevation_m: 2797, webpage: "http://volcano.si.edu/volcano.cfm?vn=241100" },
  { vnum: "241040", vName: "White Island", country: "New Zealand", latitude: -37.52, longitude: 177.18, elevation_m: 294 },
  { vnum: "283001", vName: "Abu", country: "Japan", latitude: 34.5, longitude: 131.6 },
  { vName: "NoNum", latitude: 1, longitude: 1 }, // skipped — no vnum
];

describe("parseGvpCatalog", () => {
  const entries = parseGvpCatalog(SAMPLE);
  it("maps vnum → gvp:<vnum>, skips entries without a vnum", () => {
    expect(entries).toHaveLength(3);
    expect(entries.find((e) => e.name === "Ruapehu")!.volcanoId).toBe("gvp:241100");
    expect(entries.some((e) => e.name === "NoNum")).toBe(false);
  });
  it("falls back to a GVP webpage url when none given", () => {
    expect(entries.find((e) => e.volcanoId === "gvp:241040")!.sourceUrl).toContain("vn=241040");
  });
});

describe("nearestGvp", () => {
  const entries = parseGvpCatalog(SAMPLE);
  it("matches a GeoNet point to the nearest GVP volcano within range", () => {
    // GeoNet ruapehu ~ (175.563, -39.281) → GVP 241100
    const m = nearestGvp(entries, 175.563, -39.281, 25)!;
    expect(m.entry.volcanoId).toBe("gvp:241100");
    expect(m.distanceKm).toBeLessThan(5);
  });
  it("returns null when nothing is within maxKm", () => {
    expect(nearestGvp(entries, 0, 0, 25)).toBeNull();
  });
});
