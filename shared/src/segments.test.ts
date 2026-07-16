import { quakeSegmentContent, alertSegmentContent, volcanoTrackInfo } from "./segments";
import type { Volcano } from "./volcanoes/types";

/** 2026-07-02T12:00:00Z as epoch ms — a fixed "now" so "Ago" is deterministic. */
const NOW = Date.UTC(2026, 6, 2, 12, 0, 0);
const row = (c: ReturnType<typeof quakeSegmentContent>, label: string) =>
  c.details.find((d) => d.label === label)?.value;

describe("quakeSegmentContent — time ago", () => {
  it("adds an elapsed 'Ago' row alongside the absolute 'Occurred' time", () => {
    const c = quakeSegmentContent({
      mag: 5.4,
      depthKm: 12,
      timeMs: NOW - (3 * 60 + 12) * 60_000, // 3h 12m earlier
      nowMs: NOW,
    });
    expect(row(c, "Ago")).toBe("3h 12m ago");
    expect(row(c, "Occurred")).toBe("2026-07-02 08:48 UTC");
  });

  it("reads 'just now' for a quake under a minute old", () => {
    const c = quakeSegmentContent({ mag: 4, depthKm: 5, timeMs: NOW - 30_000, nowMs: NOW });
    expect(row(c, "Ago")).toBe("just now");
  });

  it("rolls into days for old events", () => {
    const c = quakeSegmentContent({ mag: 6, depthKm: 30, timeMs: NOW - (2 * 24 * 60 + 4 * 60) * 60_000, nowMs: NOW });
    expect(row(c, "Ago")).toBe("2d 4h ago");
  });

  it("omits both time rows when no timestamp is given", () => {
    const c = quakeSegmentContent({ mag: 5, depthKm: 10 });
    expect(row(c, "Ago")).toBeUndefined();
    expect(row(c, "Occurred")).toBeUndefined();
  });
});

describe("quakeSegmentContent — magnitude & depth bands", () => {
  it("tags the magnitude row with its descriptor band", () => {
    expect(row(quakeSegmentContent({ mag: 6.3, depthKm: 12 }), "Magnitude")).toBe("M6.3 · Strong");
    expect(row(quakeSegmentContent({ mag: 4.5, depthKm: 12 }), "Magnitude")).toBe("M4.5 · Light");
  });

  it("tags the depth row with its shallow/intermediate/deep class", () => {
    expect(row(quakeSegmentContent({ mag: 5, depthKm: 12 }), "Depth")).toBe("12 km · Shallow");
    expect(row(quakeSegmentContent({ mag: 5, depthKm: 150 }), "Depth")).toBe("150 km · Intermediate");
  });
});

describe("alertSegmentContent — translated title/Type", () => {
  const base = {
    source: "wmo",
    identifier: "cn-cma-xx/2026/1",
    severityRank: 4,
    hazard: "wind" as const,
    center: [104, 35] as [number, number],
  };

  it("falls back to the raw event when there's no translation", () => {
    const c = alertSegmentContent({ ...base, event: "台风红色预警" });
    expect(c.title).toBe("台风红色预警");
    expect(c.details.find((d) => d.label === "Type")?.value).toBe("台风红色预警");
  });

  it("prefers translatedEvent for both the title and the Type row", () => {
    const c = alertSegmentContent({ ...base, event: "台风红色预警", translatedEvent: "Typhoon Red Alert" });
    expect(c.title).toBe("Typhoon Red Alert");
    expect(c.details.find((d) => d.label === "Type")?.value).toBe("Typhoon Red Alert");
  });

  it("defaults to 'Weather Warning' when neither event nor translatedEvent is set", () => {
    const c = alertSegmentContent({ ...base });
    expect(c.title).toBe("Weather Warning");
    expect(c.details.find((d) => d.label === "Type")).toBeUndefined();
  });

  it("shows 'Active for' once the onset has passed", () => {
    const now = Date.UTC(2026, 6, 13, 8, 0);
    const c = alertSegmentContent({ ...base, sinceMs: now - 90 * 60_000, nowMs: now });
    expect(c.details.find((d) => d.label === "Active since")?.value).toBe("2026-07-13 06:30 UTC");
    expect(c.details.find((d) => d.label === "Active for")?.value).toBe("1h 30m");
    expect(c.details.find((d) => d.label === "Begins in")).toBeUndefined();
  });

  it("shows 'Begins in' instead of a bogus 0m active for a future onset", () => {
    const now = Date.UTC(2026, 6, 13, 4, 30);
    const c = alertSegmentContent({ ...base, sinceMs: Date.UTC(2026, 6, 13, 7, 0), nowMs: now });
    expect(c.details.find((d) => d.label === "Begins")?.value).toBe("2026-07-13 07:00 UTC");
    expect(c.details.find((d) => d.label === "Begins in")?.value).toBe("2h 30m");
    expect(c.details.find((d) => d.label === "Active for")).toBeUndefined();
    expect(c.details.find((d) => d.label === "Active since")).toBeUndefined();
  });
});

describe("volcanoTrackInfo", () => {
  const base: Volcano = {
    id: "gvp:211060",
    name: "Etna",
    country: "Italy",
    lat: 37.748,
    lng: 14.999,
    status: "erupting",
    firstDate: 1,
    lastDate: 2,
    statusChangedAt: 2,
  };

  it("is undefined when there's no photo/blurb/bulletin at all", () => {
    expect(volcanoTrackInfo(base)).toBeUndefined();
  });

  it("prefers wikiPhoto (full-res) over wikiThumb, and the bulletin over the evergreen extract", () => {
    const info = volcanoTrackInfo({
      ...base,
      wikiThumb: "https://example.test/thumb.jpg",
      wikiPhoto: "https://example.test/full.jpg",
      wikiExtract: "An active volcano in Sicily.",
      latestReport: "INGV reported eruptive activity this week.",
    });
    expect(info?.photoUrl).toBe("https://example.test/full.jpg");
    expect(info?.extract).toBe("INGV reported eruptive activity this week.");
  });

  it("joins type/elevation/last-eruption into a single facts line", () => {
    const info = volcanoTrackInfo({
      ...base,
      wikiThumb: "https://example.test/thumb.jpg",
      volcanoType: "stratovolcano",
      elevationM: 3357,
      lastEruptionYear: 2021,
    });
    expect(info?.facts).toBe("stratovolcano · 3,357 m · last known eruption 2021");
  });

  it("only sets alert when a USGS colour code is present", () => {
    const withoutUsgs = volcanoTrackInfo({ ...base, wikiThumb: "https://example.test/thumb.jpg" });
    expect(withoutUsgs?.alert).toBeUndefined();

    const withUsgs = volcanoTrackInfo({
      ...base,
      wikiThumb: "https://example.test/thumb.jpg",
      usgsAlertLevel: "WATCH",
      usgsColorCode: "ORANGE",
      usgsNoticeSynopsis: "Lava fountaining continues.",
    });
    expect(withUsgs?.alert).toEqual({
      level: "WATCH",
      colorCode: "ORANGE",
      synopsis: "Lava fountaining continues.",
      noticeUrl: undefined,
      updatedAt: undefined,
    });
  });

  it("joins VEI/plume height into a reportFacts line", () => {
    const info = volcanoTrackInfo({
      ...base,
      wikiThumb: "https://example.test/thumb.jpg",
      reportVei: 2,
      reportPlumeHeightM: 3000,
    });
    expect(info?.reportFacts).toBe("VEI 2 · plume 3,000 m");
  });
});

/**
 * The globe draws DISSOLVED shapes — touching warnings of the same hazard,
 * severity and country fused into one weather system. A shape spanning Galicia to
 * the Basque Country is a dozen separate Spanish yellow rain warnings, and
 * `areaDesc` is only the representative member's. Naming that shape "Central y
 * Valles Mineros" tells a viewer it's one Asturian valley.
 */
describe("alertSegmentContent — a fused shape must not pose as one county", () => {
  const spain = {
    source: "meteoalarm",
    identifier: "2.49.0.0.ES.20260716",
    event: "Aviso de lluvias de nivel amarillo",
    severityRank: 2,
    areaDesc: "Central y Valles Mineros",
    hazard: "rain" as const,
    center: [-6, 42.9] as [number, number],
  };

  it("says how many warnings the shape stands for", () => {
    const c = alertSegmentContent({ ...spain, warningCount: 12 });

    expect(c.subtitle).toContain("Central y Valles Mineros +11 more");
    expect(c.details).toContainEqual({ label: "Warnings", value: "12" });
  });

  it("reads exactly as before for a shape that really is one warning", () => {
    const one = alertSegmentContent({ ...spain, warningCount: 1 });
    const bare = alertSegmentContent(spain);

    expect(one.subtitle).toBe(bare.subtitle);
    expect(one.subtitle).not.toContain("more");
    expect(one.details.find((d) => d.label === "Warnings")).toBeUndefined();
  });

  it("keeps the country on the subtitle alongside the count", () => {
    const c = alertSegmentContent({ ...spain, warningCount: 12 });

    expect(c.subtitle).toContain("Spain");
  });

  it("does not invent a count when the shape has no area name", () => {
    const c = alertSegmentContent({ ...spain, areaDesc: undefined, warningCount: 12 });

    expect(c.subtitle).not.toContain("more");
    // ...but the row still tells the truth about the fusion.
    expect(c.details).toContainEqual({ label: "Warnings", value: "12" });
  });
});
