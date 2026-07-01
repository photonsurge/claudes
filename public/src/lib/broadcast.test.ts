import { quakeTicker, alertTicker, trackTicker, buildTicker, topAlert, alertBannerText } from "./broadcast";
import type { AlertFeature } from "./alerts";
import type { Quake, Track } from "./tracks/types";

const quake = (over: Partial<Quake> = {}): Quake => ({
  id: "q1",
  mag: 5.9,
  place: "12km SSW of Somewhere",
  time: 0,
  lng: 10,
  lat: 20,
  depthKm: 10,
  ...over,
});

const alert = (rank: number, over: Partial<AlertFeature["properties"]> = {}): AlertFeature =>
  ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: {
      id: `a${rank}`,
      source: "test",
      identifier: "x",
      event: "Tsunami Watch",
      severityRank: rank as AlertFeature["properties"]["severityRank"],
      hazard: "tsunami" as AlertFeature["properties"]["hazard"],
      areaDesc: "Fiji Region",
      ...over,
    },
  }) as AlertFeature;

const track = (over: Partial<Track> = {}): Track =>
  ({ kind: "aircraft", name: "GLOBAL THUNDER-26", flag: "🇺🇸", ...over }) as Track;

describe("ticker line builders", () => {
  it("formats a quake with tsunami flag", () => {
    expect(quakeTicker(quake({ tsunami: true }))).toBe(
      "SEISMIC M5.9 · 12km SSW of Somewhere · TSUNAMI POTENTIAL",
    );
  });
  it("falls back to coords when a quake has no place", () => {
    expect(quakeTicker(quake({ place: undefined }))).toContain("20.0, 10.0");
  });
  it("prefixes an alert with its severity label", () => {
    expect(alertTicker(alert(3))).toBe("SEVERE: Tsunami Watch · Fiji Region");
  });
  it("formats a track with flag + kind", () => {
    expect(trackTicker(track())).toBe("🇺🇸 GLOBAL THUNDER-26 · AIRCRAFT");
  });
});

describe("buildTicker", () => {
  it("orders seismic → alerts → tracks and de-dupes", () => {
    const items = buildTicker({
      quakes: [quake(), quake()], // identical → one line
      alerts: [alert(2)],
      tracks: [track()],
    });
    expect(items[0]).toContain("SEISMIC");
    expect(items.some((i) => i.includes("Tsunami"))).toBe(true);
    expect(items.some((i) => i.includes("GLOBAL THUNDER"))).toBe(true);
    // The two identical quakes collapse to one.
    expect(items.filter((i) => i.startsWith("SEISMIC")).length).toBe(1);
  });
  it("returns [] with no data", () => {
    expect(buildTicker({})).toEqual([]);
  });
});

describe("topAlert / alertBannerText", () => {
  it("picks the most severe alert", () => {
    const top = topAlert([alert(1), alert(4), alert(2)]);
    expect(top?.properties.severityRank).toBe(4);
  });
  it("is null with no alerts", () => {
    expect(topAlert([])).toBeNull();
  });
  it("prefers a source level label when present", () => {
    expect(alertBannerText(alert(2, { level: "Yellow" }))).toBe(
      "Tsunami Watch: Fiji Region — YELLOW",
    );
  });
});
