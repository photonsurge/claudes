import {
  quakeTicker,
  alertTicker,
  trackTicker,
  buildTicker,
  dedupeAlerts,
  sortedAlerts,
  topAlerts,
  topAlert,
  alertBannerText,
  alertSummary,
  worldWatchSummary,
  worldWatchFeed,
} from "./broadcast";
import type { Alert, AlertFeature } from "./alerts";
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

describe("dedupeAlerts / topAlerts", () => {
  it("collapses the same area (multi-language repeats) keeping the most severe", () => {
    const de = alert(2, { event: "Heftige Gewitter", areaDesc: "Marthalen" });
    const fr = alert(4, { event: "Orages violents", areaDesc: "marthalen" }); // same area, higher sev
    const it = alert(1, { event: "Temporali", areaDesc: "MARTHALEN" });
    const other = alert(3, { areaDesc: "Fiji Region" });
    const deduped = dedupeAlerts([de, fr, it, other]);
    expect(deduped.length).toBe(2);
    // Marthalen kept at the most-severe (rank 4).
    const marthalen = deduped.find((a) => a.properties.areaDesc?.toLowerCase() === "marthalen");
    expect(marthalen?.properties.severityRank).toBe(4);
  });
  it("returns top N by severity", () => {
    const list = topAlerts([alert(1), alert(4, { areaDesc: "A" }), alert(2, { areaDesc: "B" })], 2);
    expect(list.map((a) => a.properties.severityRank)).toEqual([4, 2]);
  });
  it("sortedAlerts keeps the whole list, most-severe first (no cap)", () => {
    const list = sortedAlerts([
      alert(1, { areaDesc: "A" }),
      alert(4, { areaDesc: "B" }),
      alert(2, { areaDesc: "C" }),
    ]);
    expect(list.map((a) => a.properties.severityRank)).toEqual([4, 2, 1]);
  });
});

describe("alertSummary", () => {
  it("counts distinct alerts by severity and hazard, quakes separately", () => {
    const s = alertSummary(
      [
        alert(4, { areaDesc: "A", hazard: "fire" as any }),
        alert(4, { areaDesc: "a", hazard: "fire" as any, event: "Feu" }), // same area+hazard → 1
        alert(3, { areaDesc: "B", hazard: "flood" as any }),
        alert(2, { areaDesc: "C", hazard: "fire" as any }),
      ],
      [quake(), quake()],
    );
    expect(s.total).toBe(3); // A/fire, B/flood, C/fire (the duplicate A collapsed)
    expect(s.quakeCount).toBe(2);
    // Severity buckets, most severe first.
    expect(s.bySeverity[0].rank).toBe(4);
    expect(s.bySeverity.find((b) => b.rank === 4)?.count).toBe(1);
    // Hazard buckets, most common first: fire (2) before flood (1).
    expect(s.byHazard[0].hazard).toBe("fire");
    expect(s.byHazard[0].count).toBe(2);
  });
  it("is empty with no hazards", () => {
    const s = alertSummary([], []);
    expect(s.total).toBe(0);
    expect(s.bySeverity).toEqual([]);
    expect(s.byHazard).toEqual([]);
  });
});

describe("worldWatchSummary", () => {
  const raw = (rank: number, over: Partial<Alert> = {}): Alert =>
    ({
      id: over.id ?? `a${rank}-${Math.random()}`,
      source: "test",
      identifier: "x",
      sender: "s",
      sent: "2026-07-02T00:00:00Z",
      msgType: "Alert",
      status: "Actual",
      active: true,
      maxSeverityRank: rank as Alert["maxSeverityRank"],
      info: [],
      ...over,
    }) as Alert;

  it("buckets active alerts by severity (non-zero, most severe first) and totals them", () => {
    const s = worldWatchSummary(
      [raw(4), raw(3), raw(3), raw(0), raw(2)],
      [quake({ mag: 4.1 }), quake({ mag: 6.3, place: "off Japan" })],
    );
    expect(s.alertTotal).toBe(5); // rank-0 still counts toward the total…
    // …but is dropped from the severity breakdown.
    expect(s.bySeverity.map((b) => [b.rank, b.count])).toEqual([
      [4, 1],
      [3, 2],
      [2, 1],
    ]);
    expect(s.quakeCount).toBe(2);
    expect(s.maxMag).toBe(6.3);
    expect(s.maxQuake?.place).toBe("off Japan");
  });

  it("counts a cross-source cluster once (keeps the representative)", () => {
    const rep = raw(4, { id: "g1", groupId: "g1" });
    const member = raw(4, { id: "g1-member", groupId: "g1" });
    const solo = raw(2, { id: "solo" }); // no groupId → passes through
    const s = worldWatchSummary([rep, member, solo], []);
    expect(s.alertTotal).toBe(2);
  });

  it("is quiet with no data", () => {
    const s = worldWatchSummary([], []);
    expect(s).toMatchObject({ alertTotal: 0, bySeverity: [], quakeCount: 0, maxMag: 0, maxQuake: null });
  });
});

describe("worldWatchFeed", () => {
  const raw = (rank: number, event: string, area: string, over: Partial<Alert> = {}): Alert =>
    ({
      id: over.id ?? `${event}-${area}`,
      source: "test",
      identifier: "x",
      sender: "s",
      sent: "2026-07-02T00:00:00Z",
      msgType: "Alert",
      status: "Actual",
      active: true,
      maxSeverityRank: rank as Alert["maxSeverityRank"],
      info: [{ event, severityRank: rank, area: [{ areaDesc: area, geocodes: [] }] }],
      ...over,
    }) as Alert;

  it("lists alerts and quakes, most-serious first, with a big quake above minor alerts", () => {
    const feed = worldWatchFeed(
      [raw(4, "Tornado Warning", "Kansas"), raw(1, "Frost Advisory", "Alps")],
      [quake({ id: "big", mag: 7.2, place: "off Chile" }), quake({ id: "sm", mag: 3.1 })],
    );
    expect(feed.map((f) => f.kind)).toEqual(["alert", "quake", "alert", "quake"]);
    // Extreme alert (rank 4) and M7.2 both weight 4 — alert wins the tie, quake next.
    expect(feed[0]).toMatchObject({ kind: "alert", title: "Tornado Warning", sub: "Kansas" });
    expect(feed[1]).toMatchObject({ kind: "quake", tag: "M7.2", title: "off Chile" });
    // Then the rank-1 advisory, then the M3.1 minnow.
    expect(feed[2].title).toBe("Frost Advisory");
    expect(feed[3].tag).toBe("M3.1");
  });

  it("flags tsunami quakes and counts a cross-source cluster once", () => {
    const rep = raw(3, "Storm", "A", { id: "g1", groupId: "g1" });
    const member = raw(3, "Sturm", "A", { id: "g1-m", groupId: "g1" });
    const feed = worldWatchFeed([rep, member], [quake({ id: "t", mag: 6.5, tsunami: true })]);
    expect(feed.filter((f) => f.kind === "alert").length).toBe(1);
    expect(feed.find((f) => f.kind === "quake")?.sub).toBe("TSUNAMI POTENTIAL");
  });

  it("is empty with no data", () => {
    expect(worldWatchFeed([], [])).toEqual([]);
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
