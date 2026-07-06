import { parseEonetVolcanoes, VOLCANO_RECENT_MS } from "./eonet";

const NOW = Date.parse("2026-07-06T12:00:00Z");

const EONET_JSON = {
  events: [
    {
      id: "EONET_1",
      title: "Kilauea Volcano, Hawaii",
      sources: [{ url: "https://volcano.si.edu/volcano.cfm?vn=332010" }],
      geometry: [
        { date: "2026-06-01T00:00:00Z", type: "Point", coordinates: [-155.29, 19.42] },
        { date: "2026-07-05T00:00:00Z", type: "Point", coordinates: [-155.29, 19.42] },
      ],
    },
    {
      id: "EONET_2",
      title: "  Mount   Etna, Italy ",
      geometry: [{ date: "2026-05-01T00:00:00Z", type: "Point", coordinates: [15.0, 37.75] }],
    },
    {
      id: "EONET_3",
      title: "No Geometry Volcano",
      geometry: [],
    },
    {
      id: "EONET_4",
      title: "Bad Coords Volcano",
      geometry: [{ date: "2026-07-01T00:00:00Z", coordinates: ["nope", "nope"] }],
    },
  ],
};

describe("parseEonetVolcanoes", () => {
  it("parses events with usable point geometry, taking the latest position", () => {
    const volcanoes = parseEonetVolcanoes(EONET_JSON, NOW);
    expect(volcanoes).toHaveLength(2);
    const [kilauea] = volcanoes;
    expect(kilauea.id).toBe("EONET_1");
    expect(kilauea.name).toBe("Kilauea Volcano, Hawaii");
    expect(kilauea.lat).toBeCloseTo(19.42);
    expect(kilauea.lng).toBeCloseTo(-155.29);
    expect(kilauea.firstDate).toBe(Date.parse("2026-06-01T00:00:00Z"));
    expect(kilauea.lastDate).toBe(Date.parse("2026-07-05T00:00:00Z"));
    expect(kilauea.sourceUrl).toBe("https://volcano.si.edu/volcano.cfm?vn=332010");
  });

  it("collapses whitespace in the title", () => {
    const [, etna] = parseEonetVolcanoes(EONET_JSON, NOW);
    expect(etna.name).toBe("Mount Etna, Italy");
  });

  it("skips events with no geometry or non-numeric coordinates", () => {
    const volcanoes = parseEonetVolcanoes(EONET_JSON, NOW);
    expect(volcanoes.find((v) => v.id === "EONET_3")).toBeUndefined();
    expect(volcanoes.find((v) => v.id === "EONET_4")).toBeUndefined();
  });

  it("classifies status from recency of the last report", () => {
    const [kilauea, etna] = parseEonetVolcanoes(EONET_JSON, NOW);
    expect(NOW - kilauea.lastDate).toBeLessThan(VOLCANO_RECENT_MS);
    expect(kilauea.status).toBe("erupting");
    expect(NOW - etna.lastDate).toBeGreaterThan(VOLCANO_RECENT_MS);
    expect(etna.status).toBe("unrest");
  });
});
