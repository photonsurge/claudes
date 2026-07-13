import { parseGeonetVal } from "./geonet";

// Trimmed real-shape sample of GeoNet /volcano/val (captured live).
const SAMPLE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [175.641727, -39.133318] },
      properties: { acc: "Green", activity: "No volcanic unrest.", hazards: "…", level: 0, volcanoID: "tongariro", volcanoTitle: "Tongariro" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [177.18, -37.52] },
      properties: { acc: "Yellow", activity: "Moderate to heightened unrest.", hazards: "…", level: 2, volcanoID: "whiteisland", volcanoTitle: "Whakaari/White Island" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [175.563, -39.281] },
      properties: { acc: "Green", activity: "Minor volcanic unrest.", hazards: "…", level: 1, volcanoID: "ruapehu", volcanoTitle: "Ruapehu" },
    },
    // Malformed — no volcanoID, must be skipped.
    { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { level: 3 } },
  ],
};

describe("parseGeonetVal", () => {
  const rows = parseGeonetVal(SAMPLE);

  it("skips features without a volcanoID", () => {
    expect(rows).toHaveLength(3);
  });

  it("reads slug/title/coords and preserves the raw level", () => {
    const w = rows.find((r) => r.externalId === "whiteisland")!;
    expect(w.name).toBe("Whakaari/White Island");
    expect(w.lat).toBe(-37.52);
    expect(w.lng).toBe(177.18);
    expect(w.levelRaw).toBe("2");
    expect(w.colour).toBe("Yellow");
  });

  it("normalizes VAL levels and flags elevated (>=1)", () => {
    expect(rows.find((r) => r.externalId === "tongariro")!.normalized).toBe("normal");
    expect(rows.find((r) => r.externalId === "tongariro")!.elevated).toBe(false);
    expect(rows.find((r) => r.externalId === "ruapehu")!.normalized).toBe("advisory");
    expect(rows.find((r) => r.externalId === "ruapehu")!.elevated).toBe(true);
    expect(rows.find((r) => r.externalId === "whiteisland")!.normalized).toBe("unrest");
    expect(rows.find((r) => r.externalId === "whiteisland")!.elevated).toBe(true);
  });
});
