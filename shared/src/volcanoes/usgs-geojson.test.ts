import { parseUsgsGeojson } from "./usgs-geojson";

// Trimmed real-shape sample of the USGS VHP status GeoJSON (one per case).
const SAMPLE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-155.6, 19.4] },
      properties: {
        volcanoName: "Kilauea",
        vnum: "332010",
        alertLevel: "WATCH",
        colorCode: "ORANGE",
        noticeSynopsis: "Summit eruption ongoing.",
        noticeUrl: "https://volcanoes.usgs.gov/notice/1",
        alertDate: "2026-07-10 12:00:00",
        colorDate: "2026-07-11 06:30:00",
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-121.76, 46.85] },
      properties: {
        volcanoName: "Rainier",
        vnum: "321030",
        alertLevel: "ADVISORY",
        colorCode: "YELLOW",
        noticeSynopsis: null,
        noticeUrl: null,
        alertDate: null,
        colorDate: null,
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-122.18, 40.49] },
      properties: { volcanoName: "Lassen", vnum: "323080", alertLevel: "NORMAL", colorCode: "GREEN" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-176.58, 51.99] },
      properties: { volcanoName: "Adagdak", vnum: "311800", alertLevel: "UNASSIGNED", colorCode: "UNASSIGNED" },
    },
    // Malformed — no vnum; must be skipped, not crash.
    { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { volcanoName: "Bad" } },
  ],
};

describe("parseUsgsGeojson", () => {
  const rows = parseUsgsGeojson(SAMPLE, 1_000);

  it("skips features without a vnum", () => {
    expect(rows).toHaveLength(4);
    expect(rows.some((r) => r.name === "Bad")).toBe(false);
  });

  it("maps vnum → gvp:<vnum> and reads coordinates as [lng,lat]", () => {
    const k = rows.find((r) => r.volcanoId === "gvp:332010")!;
    expect(k.name).toBe("Kilauea");
    expect(k.lat).toBe(19.4);
    expect(k.lng).toBe(-155.6);
  });

  it("flags elevated on either scheme (WATCH/ORANGE, ADVISORY/YELLOW)", () => {
    expect(rows.find((r) => r.volcanoId === "gvp:332010")!.elevated).toBe(true);
    expect(rows.find((r) => r.volcanoId === "gvp:321030")!.elevated).toBe(true);
  });

  it("treats NORMAL/GREEN as tracked-but-not-elevated (for de-escalation, no stub)", () => {
    const l = rows.find((r) => r.volcanoId === "gvp:323080")!;
    expect(l.elevated).toBe(false);
    expect(l.unassigned).toBe(false);
  });

  it("flags UNASSIGNED so the job skips it entirely", () => {
    expect(rows.find((r) => r.volcanoId === "gvp:311800")!.unassigned).toBe(true);
  });

  it("prefers colorDate then alertDate, falling back to now", () => {
    expect(rows.find((r) => r.volcanoId === "gvp:332010")!.updatedAtMs).toBe(Date.parse("2026-07-11T06:30:00"));
    expect(rows.find((r) => r.volcanoId === "gvp:321030")!.updatedAtMs).toBe(1_000); // both dates null
  });

  it("carries the notice synopsis/url only when present", () => {
    expect(rows.find((r) => r.volcanoId === "gvp:332010")!.noticeSynopsis).toBe("Summit eruption ongoing.");
    expect(rows.find((r) => r.volcanoId === "gvp:321030")!.noticeSynopsis).toBeUndefined();
  });
});
